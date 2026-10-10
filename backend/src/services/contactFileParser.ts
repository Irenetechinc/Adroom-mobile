import { inflateRawSync } from 'zlib';

export interface ImportedCallContact {
  name: string;
  phone: string;
  email?: string;
  company?: string;
  notes?: string;
  time_zone?: string;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 500;
const MAX_XLSX_ENTRIES = 10_000;
const MAX_XLSX_XML_BYTES = 12 * 1024 * 1024;

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const source = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"' && cell.length === 0) {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell.trim());
      cell = '';
      if (row.some((item) => item.length > 0)) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
    if (rows.length > MAX_IMPORT_ROWS + 1) throw new Error(`The contact file exceeds the ${MAX_IMPORT_ROWS}-row limit.`);
  }

  if (inQuotes) throw new Error('The CSV file contains an unclosed quoted field.');
  row.push(cell.trim());
  if (row.some((item) => item.length > 0)) rows.push(row);
  return rows;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function xmlAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
    attributes[match[1]] = decodeXml(match[2]);
  }
  return attributes;
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function readZipDirectory(buffer: Buffer): ZipEntry[] {
  let end = -1;
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error('The Excel file is not a valid XLSX archive.');
  const entriesCount = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  if (entriesCount > MAX_XLSX_ENTRIES) throw new Error('The Excel file contains too many archive entries.');

  const entries: ZipEntry[] = [];
  for (let index = 0; index < entriesCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('The Excel file has a malformed archive directory.');
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    if (name.startsWith('/') || name.split('/').includes('..')) throw new Error('The Excel file contains an invalid archive path.');
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(buffer: Buffer, entry: ZipEntry): string {
  if (entry.uncompressedSize > MAX_XLSX_XML_BYTES) throw new Error('The Excel worksheet is too large to import safely.');
  const offset = entry.localOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error('The Excel file contains a malformed worksheet.');
  }
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const finish = start + entry.compressedSize;
  if (finish > buffer.length) throw new Error('The Excel file contains a truncated worksheet.');
  const compressed = buffer.subarray(start, finish);
  let uncompressed: Buffer;
  if (entry.method === 0) uncompressed = compressed;
  else if (entry.method === 8) uncompressed = inflateRawSync(compressed, { maxOutputLength: MAX_XLSX_XML_BYTES });
  else throw new Error('This Excel file uses an unsupported compression method.');
  if (uncompressed.length > MAX_XLSX_XML_BYTES) throw new Error('The Excel worksheet is too large to import safely.');
  return uncompressed.toString('utf8');
}

function normalizeZipTarget(target: string): string {
  const pieces: string[] = [];
  for (const part of target.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') pieces.pop();
    else pieces.push(part);
  }
  return target.startsWith('/') ? pieces.join('/') : `xl/${pieces.join('/')}`;
}

function parseXlsxRows(buffer: Buffer): string[][] {
  const directory = readZipDirectory(buffer);
  const byName = new Map(directory.map((entry) => [entry.name, entry]));
  const read = (name: string): string => {
    const entry = byName.get(name);
    if (!entry) throw new Error(`The Excel workbook is missing ${name}.`);
    return readZipEntry(buffer, entry);
  };

  const workbookXml = read('xl/workbook.xml');
  const firstSheetTag = workbookXml.match(/<sheet\b[^>]*>/)?.[0];
  if (!firstSheetTag) throw new Error('The Excel workbook has no worksheet.');
  const relationId = xmlAttributes(firstSheetTag)['r:id'];
  const relationsXml = read('xl/_rels/workbook.xml.rels');
  const relationTag = [...relationsXml.matchAll(/<Relationship\b[^>]*>/g)]
    .map((match) => match[0])
    .find((tag) => xmlAttributes(tag).Id === relationId);
  const target = relationTag ? xmlAttributes(relationTag).Target : 'worksheets/sheet1.xml';
  const sheetXml = read(normalizeZipTarget(target));

  const sharedStringsEntry = byName.get('xl/sharedStrings.xml');
  const sharedStrings = sharedStringsEntry
    ? [...readZipEntry(buffer, sharedStringsEntry).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
      .map((item) => [...item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
        .map((text) => decodeXml(text[1])).join(''))
    : [];

  const rows: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = xmlAttributes(`<c ${cellMatch[1]}>`);
      const reference = attributes.r || '';
      const columnLetters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase();
      if (!columnLetters) continue;
      let column = 0;
      for (const letter of columnLetters) column = column * 26 + letter.charCodeAt(0) - 64;
      const valueTag = cellMatch[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      const inlineTag = cellMatch[2].match(/<is\b[^>]*>([\s\S]*?)<\/is>/);
      const inlineText = inlineTag
        ? [...inlineTag[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1])).join('')
        : '';
      let value = valueTag ? decodeXml(valueTag[1]) : inlineText;
      if (attributes.t === 's' && valueTag) value = sharedStrings[Number(value)] ?? '';
      else if (attributes.t === 'b') value = value === '1' ? 'true' : 'false';
      row[column - 1] = value.trim();
    }
    rows.push(row.map((value) => value || ''));
    if (rows.length > MAX_IMPORT_ROWS + 1) throw new Error(`The contact file exceeds the ${MAX_IMPORT_ROWS}-row limit.`);
  }
  return rows;
}

function normalizedHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cellValue(row: string[], headers: Map<string, number>, candidates: string[]): string {
  for (const candidate of candidates) {
    const index = headers.get(candidate);
    if (index !== undefined) return String(row[index] || '').trim();
  }
  return '';
}

export function parseContactFile(buffer: Buffer, fileName: string): ImportedCallContact[] {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('The contact file is empty.');
  if (buffer.length > MAX_FILE_BYTES) throw new Error('Contact imports are limited to 5 MB.');
  const extension = fileName.toLowerCase().split('.').pop();
  let rows: string[][];
  if (extension === 'csv') rows = parseCsvRows(buffer.toString('utf8'));
  else if (extension === 'xlsx') rows = parseXlsxRows(buffer);
  else throw new Error('Choose a .csv or .xlsx file.');

  if (rows.length < 2) throw new Error('The contact file needs a header row and at least one contact.');
  const headerRow = rows[0].map(normalizedHeader);
  const headers = new Map(headerRow.map((header, index) => [header, index]));
  const phoneHeaders = ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'telephone', 'contactnumber'];
  if (!phoneHeaders.some((header) => headers.has(header))) {
    throw new Error('Add a phone or phone number column. Numbers must include a country code, such as +2348012345678.');
  }

  const contacts: ImportedCallContact[] = [];
  for (const [index, row] of rows.slice(1).entries()) {
    if (!row.some((value) => String(value || '').trim())) continue;
    if (contacts.length >= MAX_IMPORT_ROWS) throw new Error(`The contact file exceeds the ${MAX_IMPORT_ROWS}-contact limit.`);
    const phone = cellValue(row, headers, phoneHeaders);
    if (!phone) continue;
    contacts.push({
      name: cellValue(row, headers, ['name', 'fullname', 'contactname', 'person']) || `Contact ${index + 1}`,
      phone,
      email: cellValue(row, headers, ['email', 'emailaddress']),
      company: cellValue(row, headers, ['company', 'business', 'organization']),
      notes: cellValue(row, headers, ['notes', 'context', 'details']),
      time_zone: cellValue(row, headers, ['timezone', 'timezoneid', 'tz']),
    });
  }
  if (!contacts.length) throw new Error('No rows with phone numbers were found.');
  return contacts;
}

export const contactFileParserInternals = { parseCsvRows, parseXlsxRows };

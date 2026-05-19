/**
 * Email domain validation utility.
 * Blocks known fake, test, placeholder, and disposable email domains.
 * Used by the /api/auth/register endpoint to prevent junk sign-ups.
 */

const BLOCKED_DOMAINS = new Set([
  // RFC 2606 reserved / example domains — never real inboxes
  'example.com', 'example.org', 'example.net', 'example.io',
  'example.co', 'example.edu', 'example.gov', 'example.mil',
  'iana.org',

  // Generic test / placeholder domains
  'test.com', 'test.org', 'test.net', 'test.io', 'test.co',
  'testing.com', 'testing.org',
  'fake.com', 'fake.org', 'fake.net', 'fake.email',
  'invalid.com', 'invalid.org', 'invalid.net',
  'noemail.com', 'noreply.com', 'noreply.org',
  'null.com', 'null.net', 'null.org',
  'none.com', 'notreal.com', 'notanemail.com',
  'placeholder.com', 'placeholder.org',
  'sample.com', 'sample.org',
  'demo.com', 'demo.org',
  'localhost.com', 'localhost.net',

  // Common disposable / throwaway providers
  'mailinator.com', 'mailinator.org', 'mailinator.net',
  'guerrillamail.com', 'guerrillamail.org', 'guerrillamail.net',
  'guerrillamail.biz', 'guerrillamail.de', 'guerrillamail.info',
  'guerrillamailblock.com', 'grr.la', 'spam4.me',
  'sharklasers.com', 'guerrillamailblock.com', 'pokemail.net',
  'yopmail.com', 'yopmail.fr', 'yopmail.org',
  'tempmail.com', 'tempmail.net', 'tempmail.org', 'tempmail.de',
  'temp-mail.org', 'temp-mail.io', 'temp-mail.ru',
  'throwam.com', 'throwaway.email', 'throwam.com',
  'trashmail.com', 'trashmail.at', 'trashmail.io',
  'trashmail.me', 'trashmail.net', 'trashmail.org', 'trashmail.xyz',
  'dispostable.com', 'disposablemail.com', 'disposableaddress.com',
  'mailnull.com', 'mailnull.net',
  'spamgourmet.com', 'spamgourmet.org', 'spamgourmet.net',
  '10minutemail.com', '10minutemail.org', '10minutemail.net',
  '10minutemail.de', '10minutemail.co.za',
  '20minutemail.com', '20minutemail.it',
  'minutemail.com', 'minutemail.de',
  'mailnesia.com', 'mailnull.com',
  'maildrop.cc', 'mailhazard.com', 'mailhazard.us',
  'getonemail.com', 'getonemail.net',
  'getnada.com', 'nada.email',
  'burnermail.io', 'burnmail.ca',
  'byom.de', 'crazymailing.com',
  'deadaddress.com', 'despam.it',
  'filzmail.com', 'filzmail.de',
  'fleckens.hu', 'freeml.net',
  'frontflip.co.uk',
  'garbagemail.org', 'get2mail.fr',
  'gotmail.com', 'gotmail.net', 'gotmail.org',
  'hailmail.net', 'hatespam.org',
  'hidemail.de', 'hide.biz',
  'humaility.com',
  'ieh-mail.de', 'imails.info',
  'imgof.com', 'infocom.zp.ua',
  'internet.ru',
  'jetable.com', 'jetable.fr.nf', 'jetable.net', 'jetable.org',
  'jnxjn.com',
  'kasmail.com',
  'klassmaster.com',
  'klzlk.com',
  'kurzepost.de',
  'lovemeleaveme.com',
  'lr78.com',
  'maboard.com',
  'mail.by',
  'mailbucket.org',
  'mailc.net',
  'mailcat.biz',
  'mailcatch.com',
  'maileimer.de',
  'mailexpire.com',
  'mailf5.com',
  'mailfreeonline.com',
  'mailguard.me',
  'mailme.ir',
  'mailme.lv',
  'mailme24.com',
  'mailmetrash.com',
  'mailmoat.com',
  'mailms.com',
  'mailnew.com',
  'mailnull.com',
  'mailsac.com',
  'mailscrap.com',
  'mailshell.com',
  'mailsiphon.com',
  'mailslite.com',
  'mailzilla.com', 'mailzilla.org',
  'mbx.cc',
  'meltmail.com',
  'mierdamail.com',
  'mintemail.com',
  'moncourrier.fr.nf',
  'monemail.fr.nf',
  'monmail.fr.nf',
  'mt2009.com', 'mt2014.com',
  'mytrashmail.com',
  'nwytg.com', 'nwytg.net',
  'objectmail.com',
  'obobbo.com',
  'onewaymail.com',
  'ordinaryamerican.net',
  'owlpic.com',
  'pjjkp.com',
  'plexolan.de',
  'politikerclub.de',
  'poofy.org',
  'prtnx.com',
  'punkass.com',
  'putthisinyourspamdatabase.com',
  'quickinbox.com',
  'rcpt.at',
  'recode.me',
  'reconmail.com',
  'rejectmail.com',
  'rklips.com',
  'rppkn.com',
  'rtrtr.com',
  's0ny.net',
  'safe-mail.net',
  'sandelf.de',
  'saynotospams.com',
  'selfdestructingmail.com',
  'sendspamhere.com',
  'sharklasers.com',
  'shieldedmail.com',
  'shitmail.me',
  'shitmail.org',
  'shortmail.net',
  'sibmail.com',
  'skeefmail.com',
  'slippery.email',
  'smellfear.com',
  'snkmail.com',
  'sofimail.com',
  'sogetthis.com',
  'spam.la',
  'spam.mn',
  'spam.su',
  'spamavert.com',
  'spambob.com', 'spambob.net', 'spambob.org',
  'spambog.com', 'spambog.de', 'spambog.ru',
  'spambox.info', 'spambox.irishspringrealty.com',
  'spambox.us',
  'spamcannon.com', 'spamcannon.net',
  'spamcero.com',
  'spamcon.org',
  'spamcorptastic.com',
  'spamcowboy.com', 'spamcowboy.net', 'spamcowboy.org',
  'spamday.com',
  'spamdecoy.net',
  'spamex.com',
  'spamfree24.de', 'spamfree24.eu', 'spamfree24.info',
  'spamfree24.net', 'spamfree24.org',
  'spamgoes.in',
  'spamgourmet.com', 'spamgourmet.net', 'spamgourmet.org',
  'spamherelots.com', 'spamhereplease.com',
  'spamhole.com',
  'spamify.com',
  'spaminator.de',
  'spamkill.info',
  'spaml.com', 'spaml.de',
  'spammotel.com',
  'spamobox.com',
  'spamoff.de',
  'spamslicer.com',
  'spamspot.com',
  'spamstack.net',
  'spamthis.co.uk',
  'spamthisplease.com',
  'spamtrail.com',
  'spamtroll.net',
  'speed.1s.fr',
  'supermailer.jp',
  'super-auswahl.de',
  'suremail.info',
  'sweetxxx.de',
  'tafmail.com',
  'tagyourself.com',
  'teewars.org',
  'teleworm.com', 'teleworm.us',
  'tempalias.com',
  'tempe-mail.com',
  'tempemail.biz', 'tempemail.com', 'tempemail.net',
  'tempinbox.co.uk', 'tempinbox.com',
  'tempomail.fr',
  'temporaryemail.com', 'temporaryemail.net', 'temporaryemail.us',
  'temporaryforwarding.com',
  'temporaryinbox.com',
  'temporarymailaddress.com',
  'tempsky.com',
  'thankyou2010.com',
  'thecloudindex.com',
  'thelimestones.com',
  'thisisnotmyrealemail.com',
  'throwam.com',
  'tilien.com',
  'tittbit.in',
  'tmail.com', 'tmail.io', 'tmail.ws',
  'tmpjoe.com',
  'tmpeml.info',
  'toiea.com',
  'tradermail.info',
  'trash-amil.com',
  'trash-mail.at', 'trash-mail.com', 'trash-mail.de', 'trash-mail.ga',
  'trash-mail.io', 'trash-mail.xyz',
  'trash2009.com',
  'trashdevil.com', 'trashdevil.de',
  'trashmail.app',
  'trashmail.at', 'trashmail.com', 'trashmail.de', 'trashmail.io',
  'trashmail.me', 'trashmail.net', 'trashmail.org', 'trashmail.xyz',
  'trashmailer.com',
  'trashymail.com', 'trashymail.net',
  'trbvm.com',
  'trialmail.de',
  'trickmail.net',
  'triqqq.com',
  'turboprinz.de',
  'twinmail.de',
  'tyldd.com',
  'uggsrock.com',
  'uroid.com',
  'us.af',
  'venompen.com',
  'viditag.com',
  'viralplays.com',
  'vpn.st',
  'vvx7.com',
  'walala.org',
  'wegwerfmail.de', 'wegwerfmail.net', 'wegwerfmail.org',
  'wetrainbayarea.com', 'wetrainbayarea.org',
  'wh4f.org',
  'whyspam.me',
  'willhackforfood.biz',
  'willselfdestruct.com',
  'winemaven.info',
  'wronghead.com',
  'wuzupmail.net',
  'www.e4ward.com',
  'wwwnew.eu',
  'xagloo.com',
  'xemaps.com',
  'xents.com',
  'xmaily.com',
  'xoxy.net',
  'xsmail.com',
  'xwpet.com',
  'xyzfree.net',
  'yahooproduct.net',
  'yapped.net',
  'ycare.de',
  'yeah.net',
  'yep.it',
  'yogamaven.com',
  'yopmail.com', 'yopmail.fr', 'yopmail.org',
  'youmailr.com',
  'ypmail.webarnak.fr.eu.org',
  'yroid.com',
  'yuurok.com',
  'z1p.biz',
  'za.com',
  'zehnminutenmail.de',
  'zippymail.info',
  'zoemail.com', 'zoemail.net', 'zoemail.org',
  'zomg.info',
  'zsero.com',
]);

export interface EmailValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates an email address for format correctness and blocks known
 * fake, placeholder, and disposable domains.
 */
export function validateEmail(email: string): EmailValidationResult {
  const trimmed = (email || '').trim().toLowerCase();

  // Basic format check
  const formatRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!formatRegex.test(trimmed)) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }

  const parts = trimmed.split('@');
  if (parts.length !== 2) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }

  const [localPart, domain] = parts;

  // Local part must have at least 1 character
  if (!localPart || localPart.length < 1) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }

  // Domain must have at least one dot and a valid TLD of 2+ characters
  const domainParts = domain.split('.');
  if (domainParts.length < 2 || !domainParts[domainParts.length - 1] || domainParts[domainParts.length - 1].length < 2) {
    return { valid: false, error: 'Please enter a valid email domain (e.g. gmail.com).' };
  }

  // Block known fake / disposable / test domains
  if (BLOCKED_DOMAINS.has(domain)) {
    return {
      valid: false,
      error: `"${domain}" is not accepted. Please use a real email address (e.g. Gmail, Outlook, or your work email).`,
    };
  }

  // Block subdomains of blocked root domains  (e.g. user@sub.mailinator.com)
  for (let i = 1; i < domainParts.length - 1; i++) {
    const rootDomain = domainParts.slice(i).join('.');
    if (BLOCKED_DOMAINS.has(rootDomain)) {
      return {
        valid: false,
        error: `"${domain}" is not accepted. Please use a real email address.`,
      };
    }
  }

  return { valid: true };
}

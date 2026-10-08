import assert from 'assert';
import { FlutterwaveService } from './flutterwaveService';

const service = new FlutterwaveService() as any;
const testKey = '123456789012345678901234';

const vectors: Array<{ input: string; expected: string }> = [
  { input: '', expected: 'kzXML8eFwms=' },
  { input: '12345678', expected: 'HdUJNbcCCEuTNcwvx4XCaw==' },
  { input: 'lead payload: café ☕', expected: '4lGHY3iCoYZDQhS3OsrCmxoS9lFApwm+' },
  {
    input: JSON.stringify({
      card_number: '4111111111111111',
      cvv: '123',
      expiry_month: '12',
      expiry_year: '2030',
      currency: 'NGN',
      amount: 1,
      email: 'test@example.com',
      fullname: 'Example Test',
      tx_ref: 'ref-123',
      redirect_url: 'https://example.com/return',
    }),
    expected: 'X4Qq0AB5OLOeNAVYe36AZfjd/SFixS//WIFk7WFebV2yBF++tSuYrDaRDQ84WFKEG6P2Qrp2S6xP9q/d9b1a1U+Lta19tIzvPUN9cUy/T5UQUd4KR6oy0tjmxeZMvN9JCyt9Am1ETlO1yQ93SyUC5tyy9jJu7VTaQBnCkTFCEH6449QyVSqcKLXDLGy/algiZpqxZL+6iQdYBkxmjR1mi8PNtbN8DvqWSQ1V5EXr4NGtgfEOJ9So7Z0hJ2oYeTwqTjL5vyTZlv3NxzolbOl4F+aCemRI+1zTthM7AZlMRX593zniAWWE/w==',
  },
];

for (const vector of vectors) {
  assert.strictEqual(service.encrypt3DES(vector.input, testKey), vector.expected);
}

console.log('flutterwaveService encryption tests passed');

import assert from 'assert';
import { cleanReplyWithTalon } from './emailReplyCleaner';

async function main() {
  const plain = await cleanReplyWithTalon(
    `Thanks for the details.

On Tuesday, Alex wrote:
> The earlier message
> more quoted text`,
    '',
  );
  assert.strictEqual(plain, 'Thanks for the details.');

  const signed = await cleanReplyWithTalon(`I am interested.

Best regards,
Sam Example`, '');
  assert.strictEqual(signed, 'I am interested.');

  const html = await cleanReplyWithTalon('', '<div>Yes, please send the details.</div><blockquote>Old conversation</blockquote>');
  assert.match(html, /Yes, please send the details\./);
  assert.doesNotMatch(html, /Old conversation/);

  console.log('emailReplyCleaner tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

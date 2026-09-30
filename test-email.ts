import { config } from 'dotenv';
config();
import { sendEmail, generateBeautifulEmailTemplate } from './src/lib/email';

async function test() {
    console.log('Testing Brevo API with native fetch...');
    try {
        const html = generateBeautifulEmailTemplate('Test Email', '<p>This is a test email sent from the newly fixed backend!</p>');
        const result = await sendEmail({
            to: 'aunmohammad254@gmail.com',
            subject: 'Test from 1Think 2Win',
            html
        });
        console.log('Result:', result);
    } catch (error) {
        console.error('Crash:', error);
    }
}

test();

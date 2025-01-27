const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// SMTP configuration for sendzappy.com
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.sendzappy.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER || 'mailme@sendzappy.com',
        pass: process.env.SMTP_PASS || '89F04EC3C30531CA74EDF25616FBE6497ADF'
    },
    tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production'
    }
});

// Email queue implementation
class EmailQueue {
    constructor(delayMs = 3000) {
        this.queue = [];
        this.isProcessing = false;
        this.delayMs = delayMs;
    }

    async add(mailOptions) {
        return new Promise((resolve, reject) => {
            this.queue.push({ mailOptions, resolve, reject });
            if (!this.isProcessing) {
                this.processQueue();
            }
        });
    }

    async processQueue() {
        if (this.queue.length === 0) {
            this.isProcessing = false;
            return;
        }

        this.isProcessing = true;
        const { mailOptions, resolve, reject } = this.queue.shift();

        try {
            const info = await transporter.sendMail(mailOptions);
            resolve({ success: true, email: mailOptions.to, response: info.response });
        } catch (error) {
            reject({ success: false, email: mailOptions.to, error: error.message });
        }

        // Wait for the specified delay before processing the next email
        await new Promise(resolve => setTimeout(resolve, this.delayMs));
        this.processQueue();    
    }
}

const emailQueue = new EmailQueue(3000); // 3 seconds delay

// Route to send a single email
app.post('/send-single-email', async (req, res) => {
    const { to, subject, text, html } = req.body;

    const mailOptions = {
        from: 'info@sendzappy.com',
        to: to,
        subject: subject,
        text: text,
        html: html || text
    };

    try {
        const result = await emailQueue.add(mailOptions);
        res.send('Email sent: ' + result.response);
    } catch (error) {
        res.status(500).send('Error sending email: ' + error.message);
    }
});

// Route to handle CSV upload and send emails
app.post('/upload-csv', upload.single('csvFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const emails = [];
    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (row) => {
            if (row.email) {
                emails.push(row.email); // Assuming the CSV has a column named "email"
            }
        })
        .on('end', () => {
            fs.unlinkSync(req.file.path); // Delete the uploaded file after processing

            if (emails.length === 0) {
                return res.status(400).send('No valid email addresses found in the CSV.');
            }

            // Send emails to all addresses
            const subject = req.body.subject || 'Test Email';
            const text = req.body.text || 'This is a test email.';
            const html = req.body.html || text; // Add HTML support

            const sendPromises = emails.map((to) => {
                const mailOptions = {
                    from: 'info@sendzappy.com',
                    to: to,
                    subject: subject,
                    text: text,
                    html: html
                };

                return emailQueue.add(mailOptions);
            });

            Promise.all(sendPromises)
                .then(results => {
                    const successful = results.filter(result => result.success).length;
                    const failed = results.filter(result => !result.success).length;
                    res.send(`Emails sent successfully to ${successful} recipients. Failed for ${failed} recipients. Emails are being sent with a 3-second delay between each one.`);
                })
                .catch(error => {
                    res.status(500).send('Error sending emails: ' + error.message);
                });
        });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
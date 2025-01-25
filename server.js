const transporter = nodemailer.createTransport({
    host: 'smtp.sendzappy.com', // Your SMTP host
    port: 587, // Use 465 for SSL/TLS
    secure: false, // Use `true` for port 465
    auth: {
        user: 'mailme@sendzappy.com', // Your SMTP username
        pass: '89F04EC3C30531CA74EDF25616FBE6497ADF' // Your SMTP password
    },
    tls: {
        rejectUnauthorized: false // Disable certificate validation (for testing only)
    }
});

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

            const sendPromises = emails.map((to) => {
                const mailOptions = {
                    from: 'info@sendzappy.com', // Sender address
                    to: to, // Recipient email
                    subject: subject, // Subject line
                    text: text, // Plain text body
                    headers: {
                        'trackopens': 'false', // Disable open tracking
                        'trackclicks': 'false' // Disable click tracking
                    }
                };

                return transporter.sendMail(mailOptions)
                    .then(info => {
                        console.log(`Email sent to ${to}: ${info.response}`);
                        return { success: true, email: to, response: info.response };
                    })
                    .catch(error => {
                        console.error(`Error sending email to ${to}: ${error.message}`);
                        return { success: false, email: to, error: error.message };
                    });
            });

            Promise.all(sendPromises)
                .then(results => {
                    const successful = results.filter(result => result.success).length;
                    const failed = results.filter(result => !result.success).length;
                    const failedEmails = results.filter(result => !result.success).map(result => `${result.email}: ${result.error}`).join('\n');
                    res.send(`Emails sent successfully to ${successful} recipients. Failed for ${failed} recipients.\n\nFailed Emails:\n${failedEmails}`);
                })
                .catch(error => {
                    res.status(500).send('Error sending emails: ' + error.message);
                });
        });
});
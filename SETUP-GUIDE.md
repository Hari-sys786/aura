# 🔱 Aura — Complete Setup Guide

Everything you need to do from YOUR end to fully activate Aura.

---

## ✅ Already Working (No Action Needed)

| Feature | Status |
|---------|--------|
| Telegram Bot (@Tyhdd_bot) | ✅ Live |
| Gmail Email Sync | ✅ Syncing every 5 min |
| AI Chat (NVIDIA Qwen 3.5 397B) | ✅ Connected |
| Finance Tracker | ✅ Ready for data |
| Document Vault + OCR | ✅ Ready for files |
| Subscription Watchdog | ✅ Scanning emails |
| Daily Briefings (8AM/9PM UTC) | ✅ Scheduled |
| Web Dashboard | ✅ http://165.232.188.213:3001 |

---

## 🔐 Priority 1: Enable Encryption (2 minutes)

Protects your document vault and stored credentials.

1. SSH into your VPS:
   ```
   ssh root@165.232.188.213
   ```

2. Edit the Aura config:
   ```
   nano ~/.openclaw/workspace/aura/.env
   ```

3. Add a master password (use something strong):
   ```
   MASTER_PASSWORD=YourStr0ngP@ssw0rd!
   ```

4. Restart Aura:
   ```
   pkill -f "node dist/index.js"
   cd ~/.openclaw/workspace/aura
   node dist/index.js &
   ```

**Result:** Document vault files encrypted with AES-256-GCM. Crypto vault active.

---

## 📅 Priority 2: Fix Google Calendar (2 minutes)

Calendar API was enabled but might need re-verification.

1. Go to: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com

2. Make sure it says **"API Enabled"** (blue button should say "MANAGE", not "ENABLE")

3. If it's not enabled, click **ENABLE**

4. Test by asking the Telegram bot: **"What's on my calendar?"**

**Result:** Calendar events sync every 5 minutes. Conflict detection at 8 AM.

---

## 📱 Priority 3: WhatsApp Business (30 minutes)

Talk to Aura on WhatsApp.

### Step 1: Create Meta Business Account
1. Go to: https://business.facebook.com
2. Create a Business Account (if you don't have one)

### Step 2: Set Up WhatsApp Business API
1. Go to: https://developers.facebook.com
2. Click **My Apps** → **Create App** → Choose **Business** → **WhatsApp**
3. In the WhatsApp section, note:
   - **Phone Number ID** (looks like `123456789012345`)
   - **Permanent Access Token** (generate one under System Users)

### Step 3: Set Up Webhook
1. In the WhatsApp app settings → **Webhooks**
2. Set Callback URL: `https://your-domain/api/whatsapp`
3. Set Verify Token: `aura-verify`
4. Subscribe to: `messages`

### Step 4: Configure Aura
Add to `.env`:
```
WA_PHONE_NUMBER_ID=your-phone-number-id
WA_ACCESS_TOKEN=your-permanent-access-token
WA_VERIFY_TOKEN=aura-verify
```

Restart Aura.

### Step 5: Test
Send a message to your WhatsApp Business number from any phone.

**⚠️ Note:** WhatsApp Business API requires HTTPS. You'll need a domain + SSL (see "HTTPS Setup" below).

---

## 🔊 Priority 4: Alexa Skill (30 minutes)

"Alexa, ask Aura what's on my schedule"

### Step 1: Create Developer Account
1. Go to: https://developer.amazon.com
2. Sign in with your Amazon account

### Step 2: Create Skill
1. Go to: https://developer.amazon.com/alexa/console/ask
2. Click **Create Skill**
3. Name: `Aura`
4. Model: **Custom**
5. Hosting: **Provision your own**

### Step 3: Configure Intents
In the Interaction Model JSON editor, paste:
```json
{
  "interactionModel": {
    "languageModel": {
      "invocationName": "aura",
      "intents": [
        {
          "name": "AuraQueryIntent",
          "slots": [{"name": "query", "type": "AMAZON.SearchQuery"}],
          "samples": [
            "ask {query}", "tell me {query}", "{query}",
            "what is {query}", "show me {query}"
          ]
        },
        {
          "name": "ScheduleIntent",
          "samples": ["what's on my schedule", "my calendar", "today's events", "what's happening today"]
        },
        {
          "name": "EmailIntent",
          "samples": ["check my email", "any new emails", "show my inbox", "email summary"]
        },
        {
          "name": "SpendingIntent",
          "samples": ["how much did I spend", "today's spending", "my expenses", "spending summary"]
        },
        {
          "name": "BriefingIntent",
          "samples": ["morning briefing", "daily briefing", "give me my briefing", "what's the update"]
        },
        {"name": "AMAZON.HelpIntent", "samples": []},
        {"name": "AMAZON.StopIntent", "samples": []},
        {"name": "AMAZON.CancelIntent", "samples": []},
        {"name": "AMAZON.FallbackIntent", "samples": []}
      ]
    }
  }
}
```

### Step 4: Set Endpoint
1. Go to **Endpoint** tab
2. Select **HTTPS**
3. Default Region: `https://your-domain/api/alexa`
4. SSL Certificate: "My development endpoint has a certificate from a trusted authority"

### Step 5: Build & Test
1. Click **Build Model**
2. Go to **Test** tab → Enable testing
3. Type: "open aura"

**⚠️ Note:** Requires HTTPS (see below).

---

## 🏠 Priority 5: Google Home (30 minutes)

"Hey Google, talk to Aura"

### Step 1: Create Project
1. Go to: https://console.actions.google.com
2. Click **New Project** → Name: `Aura`

### Step 2: Set Up Conversational Action
1. Choose **Custom** → **Blank project**
2. Go to **Develop** → **Webhook**
3. Set fulfillment URL: `https://your-domain/api/google-home`

### Step 3: Configure Intents
Add these intents in the Actions Console:
- `welcome` — invocation handler
- `aura_query` — with `query` parameter
- `schedule`, `emails`, `spending`, `briefing`
- `goodbye`

### Step 4: Test
1. Go to **Test** tab
2. Type: "Talk to Aura"

**⚠️ Note:** Requires HTTPS (see below).

---

## 🏡 Priority 6: Home Assistant (2 minutes)

Control smart home devices through Aura.

**Prerequisite:** You need Home Assistant running on your network.

### Step 1: Get Long-Lived Token
1. Open Home Assistant → Click your profile (bottom-left)
2. Scroll to **Long-Lived Access Tokens**
3. Click **Create Token** → Name: `Aura` → Copy the token

### Step 2: Configure
Add to `.env`:
```
HA_URL=http://192.168.1.100:8123
HA_TOKEN=your-long-lived-access-token
HA_POLL_INTERVAL=60000
```

Replace `192.168.1.100` with your HA IP.

### Step 3: Restart Aura
```
pkill -f "node dist/index.js"
cd ~/.openclaw/workspace/aura && node dist/index.js &
```

### Step 4: Test
Ask the Telegram bot: **"Show my smart home devices"**

---

## 📲 Priority 7: Push Notifications — Wearables (varies)

Send alerts to Apple Watch, Wear OS, or phone.

### Option A: Firebase (Android + Wear OS)
1. Go to: https://console.firebase.google.com
2. Create project → Add Android app
3. Go to **Project Settings** → **Cloud Messaging**
4. Copy the **Server Key**
5. Add to `.env`:
   ```
   FCM_SERVER_KEY=your-server-key
   ```

### Option B: Apple Push (iOS + Apple Watch)
1. Go to: https://developer.apple.com → Certificates, IDs & Profiles
2. Create an APNs Key → Download .p8 file
3. Note: Key ID, Team ID, Bundle ID
4. Add to `.env`:
   ```
   APNS_KEY_ID=your-key-id
   APNS_TEAM_ID=your-team-id
   APNS_BUNDLE_ID=com.yourapp.aura
   ```

**Note:** Push requires a companion mobile app to receive notifications.

---

## 🐦 Priority 8: Twitter/X via Agent Reach (2 minutes)

Let Aura (and Hara) read Twitter.

### Step 1: Get Cookies
1. Open Twitter/X in Chrome → Make sure you're logged in
2. Press **F12** → **Application** tab → **Cookies** → `https://x.com`
3. Find and copy values for:
   - `auth_token`
   - `ct0`

### Step 2: Configure
Send me the values (I'll configure and delete from chat).

Or manually:
```bash
export AUTH_TOKEN="your-auth-token"
export CT0="your-ct0"
agent-reach configure twitter-cookies "auth_token=your-auth-token; ct0=your-ct0"
```

---

## 🔒 HTTPS Setup (Required for WhatsApp, Alexa, Google Home)

Free HTTPS using Cloudflare Tunnel.

### Step 1: Install Cloudflared
```bash
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
```

### Step 2: Login
```bash
cloudflared login
```
This opens a browser — select your Cloudflare domain.

### Step 3: Create Tunnel
```bash
cloudflared tunnel create aura
cloudflared tunnel route dns aura aura.yourdomain.com
```

### Step 4: Run Tunnel
```bash
cloudflared tunnel --url http://localhost:3001 run aura
```

### Step 5: Use Your HTTPS URL
Your Aura is now accessible at:
```
https://aura.yourdomain.com
```

Use this URL for Alexa, Google Home, and WhatsApp webhooks.

**Tip:** Run cloudflared as a systemd service for persistence:
```bash
cloudflared service install
systemctl enable cloudflared
systemctl start cloudflared
```

---

## 📋 Quick Reference

| What | Command / URL |
|------|--------------|
| Telegram Bot | @Tyhdd_bot |
| Dashboard | http://165.232.188.213:3001 |
| Restart Aura | `pkill -f "node dist/index.js" && cd ~/.openclaw/workspace/aura && node dist/index.js &` |
| Check Status | Ask bot: `/status` |
| Health Check | `cd ~/.openclaw/workspace/aura && node dist/cli.js doctor` |
| View Logs | Check the terminal where Aura is running |
| Config File | `~/.openclaw/workspace/aura/.env` |
| GitHub | https://github.com/Hari-sys786/aura |

---

## 🎯 Recommended Order

1. ✅ ~~Telegram~~ (done)
2. ✅ ~~Gmail~~ (done)
3. 🔐 **Encryption** ← do this now (2 min)
4. 📅 **Calendar** ← verify it's enabled (1 min)
5. 🐦 **Twitter** ← send cookies (2 min)
6. 🔒 **HTTPS tunnel** ← needed for 7-9
7. 📱 **WhatsApp** ← after HTTPS
8. 🔊 **Alexa** ← after HTTPS
9. 🏠 **Google Home** ← after HTTPS
10. 🏡 **Home Assistant** ← if you have HA
11. 📲 **Push notifications** ← needs mobile app

---

*Generated by Aura v1.0.0 🔱*

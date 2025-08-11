const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const { authenticator } = require('otplib');
const Jimp = require('jimp');
const QrCode = require('qrcode-reader');
const path = require('path');

const BOT_TOKEN = '8428857495:AAHuU5g34ZCgJJt0PF8CqTZY38dMK6tp5r0'; // এখানে আপনার বট টোকেন দিন
const CHANNEL_USERNAME = '@testprfb';
const GROUP_ID = -4932910189;
const ADMIN_CHAT_ID = 7221622037; // অ্যাডমিন চ্যাট আইডি

// Express App
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

// Bot Setup
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// MongoDB কানেকশন
mongoose.connect('mongodb+srv://MyDatabase:Cp8rNCfi15IUC6uc@cluster0.kjbloky.mongodb.net/2fa_user_id', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ MongoDB Error:', err));

// MongoDB Schema
const userSchema = new mongoose.Schema({
  chat_id: { type: Number, required: true }
});
const User = mongoose.model('User', userSchema);

const userSecrets = new Map();
const firstTimeUsers = new Set();

// otplib config
authenticator.options = {
  step: 30,
  window: 1,
  digits: 6,
  algorithm: 'sha1',
};

// চ্যানেলে ইউজার আছে কিনা চেক
async function isUserInChannel(userId) {
  try {
    const member = await bot.getChatMember(CHANNEL_USERNAME, userId);
    return ['creator', 'administrator', 'member'].includes(member.status);
  } catch {
    return false;
  }
}

// নতুন ইউজারের জন্য সাবস্ক্রিপশন চেক
async function onlyIfSubscribed(msg, actionCallback) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const isSubscribed = await isUserInChannel(userId);

  if (!isSubscribed) {
    if (!firstTimeUsers.has(chatId)) {
      firstTimeUsers.add(chatId);

      const name = msg.from.username
        ? `@${msg.from.username}`
        : `[${msg.from.first_name}](tg://user?id=${userId})`;

      bot.sendMessage(GROUP_ID, `🔔 নতুন ইউজার বট ব্যবহার করতে চেয়েছে: ${name}`, {
        parse_mode: 'Markdown'
      });

      return bot.sendMessage(chatId, `👋 আপনি প্রথমবার আমাদের বট ব্যবহার করছেন!\n🔒 আগে আমাদের চ্যানেলে যোগ দিন, তারপর বট ব্যবহার করতে পারবেন।`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔍 Telegram", url: "https://t.me/testprfb" }],
            [{ text: "✅ Joined", callback_data: "joined_dummy" }]
          ]
        }
      });
    }
    return;
  }

  // ✅ MongoDB তে chat_id সেভ
  const exists = await User.findOne({ chat_id: chatId });
  if (!exists) {
    await new User({ chat_id: chatId }).save();
  }

  actionCallback();
}

// 6-digit কোড পাঠানো
function sendCode(chatId, secret, messageId = null) {
  try {
    const code = authenticator.generate(secret);
    const remaining = authenticator.timeRemaining();

    const text = `🔐 *Secret:* \`${secret}\`\n\n✅ *Your 6-digit code:* \`${code}\`\n🕒 *Time left:* \`${remaining}s\``;

    const options = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🔄 Update', callback_data: 'update_code' }]]
      }
    };

    if (messageId) {
      bot.editMessageText(text, {
        ...options,
        chat_id: chatId,
        message_id: messageId
      });
    } else {
      bot.sendMessage(chatId, text, options);
    }
  } catch {
    bot.sendMessage(chatId, '❌ কোড তৈরি করতে সমস্যা হয়েছে। Secret টি সঠিক Base32 ফরম্যাটে আছে কি যাচাই করুন।');
  }
}

// /start
bot.onText(/\/start/, (msg) => {
  onlyIfSubscribed(msg, () => {
    bot.sendMessage(msg.chat.id, '👋 স্বাগতম! QR Code বা Secret পাঠান, আমি আপনার কোড তৈরি করব।');
  });
});

// /broadcast (Telegram Command)
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const message = match[1];

  if (chatId !== ADMIN_CHAT_ID) {
    return bot.sendMessage(chatId, '❌ এই কমান্ড ব্যবহার করার অনুমতি নেই।');
  }

  const users = await User.find({});
  let sentCount = 0;
  for (const user of users) {
    try {
      await bot.sendMessage(user.chat_id, message);
      sentCount++;
    } catch (err) {
      console.error(`Failed to send to ${user.chat_id}`);
    }
  }
  bot.sendMessage(chatId, `✅ ${sentCount} জনকে মেসেজ পাঠানো হয়েছে।`);
});

// Broadcast form (Web)
app.get('/broadcast', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Broadcast Message</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: #f5f7fa;
          margin: 0;
          padding: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
        }
        .container {
          background: white;
          padding: 30px 40px;
          border-radius: 10px;
          box-shadow: 0 8px 20px rgba(0,0,0,0.1);
          max-width: 500px;
          width: 90%;
          text-align: center;
        }
        h2 {
          margin-bottom: 20px;
          color: #333;
        }
        textarea {
          width: 100%;
          min-height: 150px;
          padding: 15px;
          border-radius: 8px;
          border: 1px solid #ccc;
          resize: vertical;
          font-size: 16px;
          font-family: inherit;
          box-sizing: border-box;
          transition: border-color 0.3s ease;
        }
        textarea:focus {
          border-color: #007bff;
          outline: none;
        }
        button {
          margin-top: 20px;
          background: #007bff;
          border: none;
          padding: 12px 25px;
          border-radius: 6px;
          color: white;
          font-size: 18px;
          cursor: pointer;
          transition: background-color 0.3s ease;
        }
        button:hover {
          background: #0056b3;
        }
        .footer {
          margin-top: 15px;
          font-size: 14px;
          color: #666;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>Send Broadcast Message</h2>
        <form action="/broadcast" method="POST">
          <textarea name="message" placeholder="Write your message here..." required></textarea>
          <br />
          <button type="submit">Send Message</button>
        </form>
        <div class="footer">Powered by 2FA Authenticator</div>
      </div>
    </body>
    </html>
  `);
});

app.post('/broadcast', async (req, res) => {
  const message = req.body.message;
  if (!message || message.trim() === '') {
    return res.send('❌ Message cannot be empty');
  }

  const users = await User.find({});
  let sentCount = 0;
  for (const user of users) {
    try {
      await bot.sendMessage(user.chat_id, message);
      sentCount++;
    } catch (err) {
      console.error(`❌ Failed to send to ${user.chat_id}`);
    }
  }

  res.send(`✅ ${sentCount} জনকে মেসেজ পাঠানো হয়েছে`);
});

// মেসেজ হ্যান্ডলিং
bot.on('message', (msg) => {
  onlyIfSubscribed(msg, async () => {
    const chatId = msg.chat.id;

    if (msg.photo) {
      const photo = msg.photo[msg.photo.length - 1];
      const filePath = await bot.downloadFile(photo.file_id, __dirname);

      try {
        const img = await Jimp.read(filePath);
        const qr = new QrCode();

        qr.callback = function (err, value) {
          if (err || !value || !value.result) {
            return bot.sendMessage(chatId, '❌ QR কোড পড়া যায়নি।');
          }

          const match = value.result.match(/otpauth:\/\/totp\/[^?]+\?secret=([A-Z2-7]+)/i);
          if (match) {
            const secret = match[1];
            userSecrets.set(chatId, secret);
            sendCode(chatId, secret);
          } else {
            bot.sendMessage(chatId, '❌ QR থেকে Secret পাওয়া যায়নি।');
          }
        };

        qr.decode(img.bitmap);
      } catch {
        bot.sendMessage(chatId, '❌ QR কোড পড়তে সমস্যা হয়েছে।');
      }
      return;
    }

    if (msg.text && !msg.text.startsWith('/start') && !msg.text.startsWith('/broadcast')) {
      const secret = msg.text.trim();
      try {
        authenticator.generate(secret);
        userSecrets.set(chatId, secret);
        sendCode(chatId, secret);
      } catch {
        bot.sendMessage(chatId, '❌ Invalid 2FA secret. Base32 format ব্যবহার করুন।');
      }
    }
  });
});

// callback query
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  if (query.data === 'joined_dummy') {
    return bot.answerCallbackQuery(query.id, { text: '✅ ধন্যবাদ!' });
  }

  const isSubscribed = await isUserInChannel(chatId);
  if (!isSubscribed) return;

  const secret = userSecrets.get(chatId);
  if (!secret) {
    return bot.answerCallbackQuery(query.id, { text: '❌ Secret পাওয়া যায়নি। আগে Secret দিন।' });
  }

  sendCode(chatId, secret, messageId);
  bot.answerCallbackQuery(query.id);
});

// Root Route
app.get('/', (req, res) => {
  res.send(`<h1>Bot Running</h1>`);
});

// Start Server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
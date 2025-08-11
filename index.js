const TelegramBot = require('node-telegram-bot-api');
const { authenticator } = require('otplib');
const Jimp = require('jimp');
const QrCode = require('qrcode-reader');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');

const app = express();

const BOT_TOKEN = '8428857495:AAHuU5g34ZCgJJt0PF8CqTZY38dMK6tp5r0'; 
const CHANNEL_USERNAME = '@testprfb';
const GROUP_ID = -4932910189;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const userSecrets = new Map();
const firstTimeUsers = new Set();

// MongoDB কানেকশন
mongoose.connect('mongodb+srv://MyDatabase:Cp8rNCfi15IUC6uc@cluster0.kjbloky.mongodb.net/telegram_id', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ MongoDB Error:', err));

// MongoDB Schema
const userSchema = new mongoose.Schema({
  chat_id: { type: Number, required: true }
});
const User = mongoose.model('User', userSchema);

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

// /broadcast <message>
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const message = match[1];

  // শুধুমাত্র অ্যাডমিন ব্যবহার করতে পারবে (আপনার chat_id দিন)
  if (chatId !== 7221622037) {
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

app.get('/', (req, res) => {
  res.send(`<h1>Bot Run</h1>`);
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Bot Run ${PORT}`);
});
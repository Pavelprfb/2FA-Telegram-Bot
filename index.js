const TelegramBot = require('node-telegram-bot-api');
const { authenticator } = require('otplib');
const Jimp = require('jimp');
const QrCode = require('qrcode-reader');
const path = require('path');

const BOT_TOKEN = '8220683070:AAGhYCb8mfVyzlaWbSl6JY6lVlMkSCM-yzQ';
const CHANNEL_USERNAME = '@testprfb';
const GROUP_ID = -4932910189;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const userSecrets = new Map();
const firstTimeUsers = new Set();

// ✅ otplib config
authenticator.options = {
  step: 30,
  window: 1,
  digits: 6,
  algorithm: 'sha1'
};

// ✅ চ্যানেলে যুক্ত কিনা যাচাই
async function isUserInChannel(userId) {
  try {
    const member = await bot.getChatMember(CHANNEL_USERNAME, userId);
    return ['creator', 'administrator', 'member'].includes(member.status);
  } catch {
    return false;
  }
}

// ✅ সাবস্ক্রিপশন চেক
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

  actionCallback();
}

// ✅ কোড পাঠানো ফাংশন
function sendCode(chatId, secret, messageId = null) {
  try {
    const code = authenticator.generate(secret);
    const remaining = authenticator.timeRemaining();

    const text = `🔐 *Secret:* \`${secret}\`\n\n✅ *Your 6-digit code:* \`${code}\`\n🕒 *Time left:* \`${remaining}s\``;

    const options = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Copy', callback_data: 'copy_code' }],
          [{ text: '🔄 Update', callback_data: 'update_code' }]
        ]
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
  } catch (error) {
    bot.sendMessage(chatId, '❌ কোড তৈরি করতে সমস্যা হয়েছে। Secret টি সঠিক Base32 ফরম্যাটে আছে কি যাচাই করুন।');
  }
}

// ▶️ /start
bot.onText(/\/start/, (msg) => {
  onlyIfSubscribed(msg, () => {
    bot.sendMessage(msg.chat.id, '👋 স্বাগতম! QR Code বা Secret পাঠান, আমি আপনার কোড তৈরি করব।');
  });
});

// 📩 মেসেজ হ্যান্ডলার
bot.on('message', (msg) => {
  onlyIfSubscribed(msg, async () => {
    const chatId = msg.chat.id;

    // যদি QR কোড হয়
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

    // যদি Secret পাঠায়
    if (msg.text && !msg.text.startsWith('/start')) {
      const secret = msg.text.trim();
      try {
        authenticator.generate(secret); // validate
        userSecrets.set(chatId, secret);
        sendCode(chatId, secret);
      } catch {
        bot.sendMessage(chatId, '❌ Invalid 2FA secret. Base32 format ব্যবহার করুন।');
      }
    }
  });
});

// 🔄 Callback Query হ্যান্ডলার
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  if (query.data === 'joined_dummy') {
    return bot.answerCallbackQuery(query.id, { text: '✅ ধন্যবাদ!', show_alert: false });
  }

  const isSubscribed = await isUserInChannel(chatId);
  if (!isSubscribed) return;

  const secret = userSecrets.get(chatId);
  if (!secret) {
    return bot.answerCallbackQuery(query.id, { text: '❌ Secret পাওয়া যায়নি। আগে Secret দিন।' });
  }

  if (query.data === 'copy_code') {
    const code = authenticator.generate(secret);
    bot.sendMessage(chatId, `✅ Code copied: \`${code}\``, { parse_mode: 'Markdown' });
    return bot.answerCallbackQuery(query.id, { text: '📋 Code ready to copy!', show_alert: false });
  }

  if (query.data === 'update_code') {
    sendCode(chatId, secret, messageId);
    return bot.answerCallbackQuery(query.id);
  }
});
const TelegramBot = require('node-telegram-bot-api');
const { totp } = require('otplib');
const Jimp = require('jimp');
const QrCode = require('qrcode-reader');

const BOT_TOKEN = '8220683070:AAGhYCb8mfVyzlaWbSl6JY6lVlMkSCM-yzQ';
const CHANNEL_USERNAME = '@testprfb';
const GROUP_ID = -4932910189; // আপনার Telegram group ID

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const userSecrets = new Map();
const firstTimeUsers = new Set();

// ✅ চ্যানেলে যুক্ত কিনা যাচাই
async function isUserInChannel(userId) {
  try {
    const member = await bot.getChatMember(CHANNEL_USERNAME, userId);
    return ['creator', 'administrator', 'member'].includes(member.status);
  } catch {
    return false;
  }
}

// ✅ নতুন ইউজার চেক এবং অনুমতি
async function onlyIfSubscribed(msg, actionCallback) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const isSubscribed = await isUserInChannel(userId);

  if (!isSubscribed) {
    const isFirstTime = !firstTimeUsers.has(chatId);
    firstTimeUsers.add(chatId);

    if (isFirstTime) {
      const name = msg.from.username
        ? `@${msg.from.username}`
        : `[${msg.from.first_name}](tg://user?id=${userId})`;

      // 📢 Notify to group
      bot.sendMessage(GROUP_ID, `🔔 নতুন ইউজার বট ব্যবহার করতে চেয়েছে: ${name}`, {
        parse_mode: 'Markdown'
      });

      // ✅ Join instruction
      return bot.sendMessage(chatId, `👋 আপনি প্রথমবার আমাদের বট ব্যবহার করছেন!\n🔒 আগে আমাদের চ্যানেলে যোগ দিন, তারপর বট ব্যবহার করতে পারবেন।`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔍 Telegram", url: "https://t.me/testprfb" }],
            [{ text: "✅ Joined", callback_data: "joined_dummy" }]
          ]
        }
      });
    }

    // ✅ দ্বিতীয়বার হলে কিছু না বলেই থেমে যাবে
    return;
  }

  actionCallback();
}

// ✅ 6-digit কোড জেনারেট
function sendCode(chatId, secret, messageId = null) {
  const code = totp.generate(secret);
  const remaining = totp.timeRemaining();

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
}

// ▶️ /start command
bot.onText(/\/start/, (msg) => {
  onlyIfSubscribed(msg, () => {
    bot.sendMessage(msg.chat.id, '👋 স্বাগতম! QR Code বা Secret পাঠান, আমি আপনার কোড তৈরি করব।');
  });
});

// 📩 মেসেজ হ্যান্ডলিং
bot.on('message', (msg) => {
  onlyIfSubscribed(msg, async () => {
    const chatId = msg.chat.id;

    // 📷 যদি QR কোড image হয়
    if (msg.photo) {
      const photo = msg.photo[msg.photo.length - 1];
      const filePath = await bot.downloadFile(photo.file_id, __dirname);
      const img = await Jimp.read(filePath);
      const qr = new QrCode();

      qr.callback = function (err, value) {
        if (err || !value || !value.result) {
          return bot.sendMessage(chatId, '❌ QR কোড পড়া যায়নি।');
        }

        const result = value.result;
        const match = result.match(/secret=([A-Z2-7]+)/i);

        if (match) {
          const secret = match[1];
          userSecrets.set(chatId, secret);
          sendCode(chatId, secret);
        } else {
          bot.sendMessage(chatId, '❌ QR থেকে Secret পাওয়া যায়নি।');
        }
      };

      qr.decode(img.bitmap);
      return;
    }

    // 🔐 Secret পাঠালে
    if (msg.text && !msg.text.startsWith('/start')) {
      const secret = msg.text.trim();
      try {
        totp.generate(secret); // validate
        userSecrets.set(chatId, secret);
        sendCode(chatId, secret);
      } catch {
        bot.sendMessage(chatId, '❌ Invalid 2FA secret. Base32 format ব্যবহার করুন।');
      }
    }
  });
});

// 🔄 Update + Dummy button
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  if (query.data === 'joined_dummy') {
    return bot.answerCallbackQuery(query.id, { text: '✅ ধন্যবাদ!', show_alert: false });
  }

  const isSubscribed = await isUserInChannel(chatId);
  if (!isSubscribed) {
    return; // ❌ সাবস্ক্রাইব না থাকলে কিছুই বলবে না
  }

  const secret = userSecrets.get(chatId);
  if (!secret) {
    return bot.answerCallbackQuery(query.id, { text: '❌ Secret পাওয়া যায়নি। আগে Secret দিন।' });
  }

  sendCode(chatId, secret, messageId);
  bot.answerCallbackQuery(query.id);
});
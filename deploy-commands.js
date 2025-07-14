const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const config = require('./config.json');

const roomChoices = Object.entries(config.channels).map(([channelId]) => ({
  name: `Room ${channelId}`,
  value: channelId,
}));

const commands = [
  new SlashCommandBuilder()
    .setName('post')
    .setDescription('نشر محتوى حسب الإعدادات')
    .addStringOption(option =>
      option
        .setName('room')
        .setDescription('اختر الروم للنشر')
        .setRequired(true)
        .addChoices(...roomChoices)
    )
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('نوع المحتوى')
        .setRequired(true)
        .addChoices(
          { name: 'صور فقط', value: 'image' },
          { name: 'فيديو فقط', value: 'video' },
          { name: 'كلاهما', value: 'both' }
        )
    )
    .addIntegerOption(option =>
      option
        .setName('count')
        .setDescription('عدد المنشورات (3 إلى 100)')
        .setRequired(true)
        .setMinValue(3)
        .setMaxValue(100)
    )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
  try {
    console.log('🌀 جاري تسجيل الأمر /post...');
    await rest.put(
      Routes.applicationCommands(config.clientId),
      { body: commands }
    );
    console.log('✅ تم تسجيل الأمر بنجاح.');
  } catch (err) {
    console.error('❌ خطأ أثناء التسجيل:', err);
  }
})();
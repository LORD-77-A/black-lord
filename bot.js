const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const Lowdb = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const fetch = require('node-fetch');
const config = require('./config.json');
const rules = require('./rule.json');

const adapter = new FileSync('db.json');
const db = Lowdb(adapter);
db.defaults({ postedUrls: [], history: [], deletions: [] }).write();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

function hasPermission(member, command) {
    const allowedRoles = (rules[command] || []).map(r => r.id);
    return member.roles.cache.some(r => allowedRoles.includes(r.id));
}

function removeInvisibleChars(text) {
    return text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

function hasBannedTags(tagsString, bannedTagsList = config.bannedTags) {
    const tags = tagsString.toLowerCase().split(' ');
    return bannedTagsList.some(banned => tags.includes(banned.toLowerCase()));
}

function isVideo(url) {
    return /\.(mp4|webm)$/i.test(url);
}

function isImage(url) {
    return /\.(jpg|jpeg|png)$/i.test(url);
}

function isAllowedType(url, type) {
    if (!url) return false;
    if (type === 'video') return isVideo(url);
    if (type === 'image') return isImage(url);
    return isImage(url) || isVideo(url);
}

async function fetchGelbooruPosts(tags, limit) {
    const results = [];
    let page = 0;
    const perPage = 100;

    while (results.length < limit) {
        const countToFetch = Math.min(perPage, limit - results.length);
        const tagQuery = encodeURIComponent(tags.join(' ') + ' rating:explicit');
        const url = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=${tagQuery}&limit=${countToFetch}&pid=${page}&api_key=${config.api_key}&user_id=${config.user_id}`;

        try {
            const res = await fetch(url);
            const data = await res.json();
            if (!data?.post || data.post.length === 0) break;
            results.push(...data.post);
            if (data.post.length < countToFetch) break;
            page++;
        } catch {
            break;
        }
    }

    return results.slice(0, limit);
}
async function fetchDanbooruPosts(tags, limit) {
    const results = [];
    let page = 1;
    const perPage = 100;

    while (results.length < limit) {
        const countToFetch = Math.min(perPage, limit - results.length);
        const tagQuery = tags.join('+') + '+rating:explicit';
        const url = `https://danbooru.donmai.us/posts.json?tags=${tagQuery}&limit=${countToFetch}&page=${page}&login=${config.danbooru.login}&api_key=${config.danbooru.api_key}`;

        try {
            const res = await fetch(url);
            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) break;
            results.push(...data);
            if (data.length < countToFetch) break;
            page++;
        } catch {
            break;
        }
    }

    return results.slice(0, limit);
}
async function postContent(channel, tags, type, count, userId) {
    const postedUrls = db.get('postedUrls').value();
    const postedUrlsSet = new Set(postedUrls.map(p => p.url));
    const results = [];

    const sources = [
        { name: 'Rule34', fetch: () => fetchRule34Posts(tags, 25000) },
        { name: 'Gelbooru', fetch: () => fetchGelbooruPosts(tags, 25000) },
        { name: 'Danbooru', fetch: () => fetchDanbooruPosts(tags, 25000) }
    ];

    for (let round = 0; round < 5 && results.length < count; round++) {
        for (const source of sources) {
            const posts = await source.fetch();

            for (const post of posts) {
                if (results.length >= count) break;

                const url = post.file_url || post.file?.url || post.fileUrl;
                if (!url || !isAllowedType(url, type)) continue;

                let postTags = '';
                if (Array.isArray(post.tags)) postTags = post.tags.join(' ');
                else if (typeof post.tags === 'string') postTags = post.tags;
                else if (typeof post.tag_string === 'string') postTags = post.tag_string;

                if (hasBannedTags(postTags, config.bannedTags)) continue;
                if (postedUrlsSet.has(url)) continue;

                try {
                    await channel.send(url);

                    // ✅ سجل في postedUrls مع channelId
                    db.get('postedUrls').push({ url, channelId: channel.id }).write();

                    // ✅ سجل في history
                    db.get('history').push({
                        channelId: channel.id,
                        url,
                        userId,
                        timestamp: new Date().toISOString()
                    }).write();

                    postedUrlsSet.add(url);
                    results.push(post);
                } catch (e) {
                    console.error(`❌ فشل إرسال الرابط: ${url}`, e);
                }
            }
        }
    }

    return results.length;
}
async function fetchRule34Posts(tags, limit) {
    const results = [];
    let page = 0;
    const perPage = 100;

    while (results.length < limit) {
        const countToFetch = Math.min(perPage, limit - results.length);
        const tagQuery = tags.join('+') + '+rating:explicit';
        const url = `${config.rule34.baseUrl}&tags=${tagQuery}&limit=${countToFetch}&pid=${page}`;

        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': config.rule34.userAgent || 'DiscordBot' }
            });

            const contentType = res.headers.get('content-type');
            if (!res.ok || !contentType?.includes('application/json')) break;

            const data = await res.json();
            if (!data?.post || data.post.length === 0) break;

            results.push(...data.post);
            if (data.post.length < countToFetch) break;
            page++;
        } catch {
            break;
        }
    }

    return results.slice(0, limit);
}
const xml2js = require('xml2js');
const parser = new xml2js.Parser();

async function getSafeHentaiGif(tags = []) {
    const query = [...tags, 'animated', 'gif', 'rating:explicit']
        .filter(t => !config.bannedTags.includes(t.toLowerCase()))
        .join('+');

    const url = `https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&tags=${query}&limit=100&pid=0`;

    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': config.rule34?.userAgent || 'DiscordBot' }
        });
        const xml = await res.text();
        const parsed = await parser.parseStringPromise(xml);
        const posts = parsed?.posts?.post || [];
        const gifs = posts.filter(p => p.$?.file_url?.endsWith('.gif'));
        if (gifs.length === 0) return null;

        const random = gifs[Math.floor(Math.random() * gifs.length)];
        return random.$.file_url;
    } catch (err) {
        console.warn('⚠️ فشل في جلب صورة GIF من Rule34:', err.message);
        return null;
    }
}
function getTimeLimit(duration) {
    const now = Date.now();
    const map = {
        day: 86400000,
        week: 604800000,
        month: 2592000000,
        year: 31536000000
    };
    return new Date(now - (map[duration] || 0));
}

async function registerSlashCommands() {
    const roomChoices = Object.entries(config.channels).map(([id, data]) => ({
        name: data.name,
        value: id
    }));

    const commands = [
        new SlashCommandBuilder()
            .setName('post')
            .setDescription('نشر محتوى تلقائي')
            .addStringOption(opt =>
                opt.setName('room')
                    .setDescription('اختيار الروم')
                    .setRequired(true)
                    .addChoices(...roomChoices)
            )
            .addStringOption(opt =>
                opt.setName('type')
                    .setDescription('نوع المحتوى')
                    .setRequired(true)
                    .addChoices(
                        { name: 'صور فقط', value: 'image' },
                        { name: 'فيديو فقط', value: 'video' },
                        { name: 'كلاهما', value: 'both' }
                    )
            )
            .addIntegerOption(opt =>
                opt.setName('count')
                    .setDescription('عدد المنشورات(5-250)5')
                    .setRequired(true)
                    .setMinValue(5)
                    .setMaxValue(250)
            ),

        new SlashCommandBuilder()
            .setName('reset')
            .setDescription('إعادة ضبط سجل النشر')
            .addStringOption(opt =>
                opt.setName('room')
                    .setDescription('حدد روم أو اختر كل الرومات')
                    .setRequired(true)
                    .addChoices(
                        { name: 'كل الرومات', value: 'all' },
                        ...roomChoices
                    )
            )
            .addStringOption(opt =>
                opt.setName('reason')
                    .setDescription('سبب إعادة الضبط')
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName('info')
            .setDescription('عرض إحصائيات النشر فقط')
            .addStringOption(opt =>
                opt.setName('duration')
                    .setDescription('اختر المدة')
                    .setRequired(true)
                    .addChoices(
                        { name: 'اليوم', value: 'day' },
                        { name: 'الأسبوع', value: 'week' },
                        { name: 'الشهر', value: 'month' },
                        { name: 'السنة', value: 'year' }
                    )
            )
            .addStringOption(opt =>
                opt.setName('room')
                    .setDescription('اختياري: تحديد روم')
                    .addChoices(...roomChoices)
            ),

        new SlashCommandBuilder()
            .setName('reset_log')
            .setDescription('عرض عمليات حذف سجل النشر')
            .addStringOption(opt =>
                opt.setName('duration')
                    .setDescription('اختر المدة')
                    .setRequired(true)
                    .addChoices(
                        { name: 'اليوم', value: 'day' },
                        { name: 'الأسبوع', value: 'week' },
                        { name: 'الشهر', value: 'month' },
                        { name: 'السنة', value: 'year' }
                    )
            )
            .addStringOption(opt =>
                opt.setName('room')
                    .setDescription('اختياري: تحديد روم')
                    .addChoices(...roomChoices)
            ),

        new SlashCommandBuilder()
            .setName('help')
            .setDescription('عرض قائمة الأوامر مع الشرح'),
    ];

    const rest = new REST({ version: '10' }).setToken(config.token);
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
}

client.once('ready', async () => {
    console.log(`🤖 البوت شغّال كـ ${client.user.tag}`);
    await registerSlashCommands();
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;
    if (command === 'post') {
        if (!hasPermission(interaction.member, 'POST')) {
            return interaction.reply({ content: '**__🚫 لا تملك صلاحية لاستخدام هذا الأمر__**', flags: 64 });
        }

        const channelId = interaction.options.getString('room');
        const type = interaction.options.getString('type');
        const count = interaction.options.getInteger('count');

        const targetChannel = await client.channels.fetch(channelId).catch(() => null);
        if (!targetChannel) {
            return interaction.reply({ content: '**__❌ لا يمكن الوصول للروم المحدد__**', flags: 64 });
        }

        const tags = config.channels[channelId]?.tags || [];


        await interaction.reply({
            content: '**__⏳ جاري  بحث عن منشورات ونشرها ...__**',
            flags: 64
        });

        const sentCount = await postContent(targetChannel, tags, type, count, interaction.user.id);

        if (sentCount === 0) {
            return interaction.editReply({
                content: `**__⚠️ لم يتم العثور على محتوى مناسب للتاقات: \`${tags.join(', ')}\`__**`
            });
        }

        await interaction.editReply({
            content: `**__✅ تم نشر ${sentCount} منشور في <#${channelId}>__**`
        });

        const reportChannel = await client.channels.fetch(config.summaryChannel);
        const embed = new EmbedBuilder()
            .setTitle('📊 تقرير نشر تلقائي')
            .setColor('Orange')
            .setDescription([
                `📍 **__القناة__:** <#${channelId}>`,
                `\n📦 **__عدد المنشورات: ${sentCount}__**`,
                `\n👤 **__بواسطة:__** <@${interaction.user.id}>`,
                `\n🕒 **__الوقت__:**\n**__ <t:${Math.floor(Date.now() / 1000)}:F>__**`
            ].join('\n'))
            .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
            .setImage('https://cdn.discordapp.com/attachments/1339992638677323867/1392934377054273647/ab1aaa451bd920085c3a982fc532cf536a1eeca8f32037eda2393eb640d49612.png?ex=6874a27a&is=687350fa&hm=effd4ce54fd1e44a1a119354b61e37e45da20f876d2403552630b6ae77dd11f0&')
            .setTimestamp();



        await reportChannel.send({ embeds: [embed] });
    }

    else if (command === 'reset') {
        if (!hasPermission(interaction.member, 'RESET')) {
            return interaction.reply({ content: '**__🚫 لا تملك صلاحية لاستخدام هذا الأمر__**', flags: 64 });
        }

        const room = interaction.options.getString('room');
        const reason = interaction.options.getString('reason');
        const affectedChannels = room === 'all' ? Object.keys(config.channels) : [room];

        const embedConfirm = new EmbedBuilder()
            .setTitle('⚠️ تأكيد إعادة ضبط')
            .setColor('Yellow')
            .setDescription(`هل أنت متأكد من حذف المنشورات من:\n${affectedChannels.map(id => `🔸 <#${id}>`).join('\n')}\n\n**السبب:** ${reason}`)
            .setImage('https://cdn.discordapp.com/attachments/1339992638677323867/1392934377054273647/ab1aaa451bd920085c3a982fc532cf536a1eeca8f32037eda2393eb640d49612.png?ex=6874a27a&is=687350fa&hm=effd4ce54fd1e44a1a119354b61e37e45da20f876d2403552630b6ae77dd11f0&')
            .setTimestamp();

        await interaction.reply({
            embeds: [embedConfirm],
            components: [{
                type: 1,
                components: [
                    { type: 2, label: 'نعم', style: 3, custom_id: 'confirm_reset' },
                    { type: 2, label: 'لا', style: 4, custom_id: 'cancel_reset' }
                ]
            }],
            flags: 64
        });

        const filter = i => ['confirm_reset', 'cancel_reset'].includes(i.customId) && i.user.id === interaction.user.id;
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 15000, max: 1 });

        collector.on('collect', async i => {
            if (i.customId === 'cancel_reset') {
                return i.update({ content: '**❌ تم إلغاء العملية.**', components: [] });
            }

            const oldPosts = db.get('postedUrls').value();
            let deletedCount = 0;
            let remaining = oldPosts;

            let deletedChannels = [];

            if (room === 'all') {
                deletedCount = oldPosts.length;
                deletedChannels = [...new Set(oldPosts.map(p => p.channelId))];
                remaining = [];
            } else {
                deletedCount = oldPosts.filter(p => p.channelId === room).length;
                deletedChannels = [room];
                remaining = oldPosts.filter(p => p.channelId !== room);
            }

            db.set('postedUrls', remaining).write();

            // سجل الحذف في deletions
            for (const id of deletedChannels) {
                const count = oldPosts.filter(p => p.channelId === id).length;
                if (count > 0) {
                    db.get('deletions')
                        .push({
                            channelId: id,
                            deletedBy: interaction.user.id,
                            deletedCount: count,
                            reason,
                            timestamp: new Date().toISOString()
                        })
                        .write();
                }
            }

            await i.update({ content: `**✅ تم حذف ${deletedCount} منشور من ${room === 'all' ? 'جميع الرومات' : `<#${room}>`}**`, components: [] });

            const reportChannel = await client.channels.fetch(config.summaryChannel);
            const gif = await getSafeHentaiGif();

            const embed = new EmbedBuilder()
                .setTitle('🧹 سجل حذف منشورات')
                .setColor('Purple')
                .setDescription([
                    `**تم حذف منشورات من:**\n${deletedChannels.map(id => `🔸 <#${id}>`).join('\n')}`,
                    `**عدد المنشورات:** ${deletedCount}`,
                    `**بواسطة:** <@${interaction.user.id}>`,
                    `**السبب:** ${reason}`,
                    `**الوقت:** <t:${Math.floor(Date.now() / 1000)}:F>`
                ].join('\n'))
                .setImage('https://cdn.discordapp.com/attachments/1339992638677323867/1392934377054273647/ab1aaa451bd920085c3a982fc532cf536a1eeca8f32037eda2393eb640d49612.png?ex=6874a27a&is=687350fa&hm=effd4ce54fd1e44a1a119354b61e37e45da20f876d2403552630b6ae77dd11f0&')
                .setTimestamp();




            await reportChannel.send({ embeds: [embed] });
        });
    }
    else if (command === 'info') {
        if (!hasPermission(interaction.member, 'INFO')) {
            return interaction.reply({ content: '🚫 لا تملك صلاحية لاستخدام هذا الأمر', flags: 64 });
        }

        const duration = interaction.options.getString('duration');
        const roomId = interaction.options.getString('room');
        const since = getTimeLimit(duration);

        const filtered = db.get('history').filter(e =>
            new Date(e.timestamp) >= since &&
            (!roomId || e.channelId === roomId)
        ).value();

        if (filtered.length === 0) {
            return interaction.reply({ content: '**📭 لا يوجد منشورات خلال هذه الفترة**', flags: 64 });
        }

        const stats = {};
        for (const entry of filtered) {
            const room = entry.channelId;
            if (!stats[room]) stats[room] = { total: 0, users: {} };
            stats[room].total++;
            stats[room].users[entry.userId] = (stats[room].users[entry.userId] || 0) + 1;
        }

        let desc = '';
        for (const [room, data] of Object.entries(stats)) {
            desc += `**📌 <#${room}>**\n`;
            desc += `📈 مجموع النشر: ${data.total}\n`;
            for (const [uid, cnt] of Object.entries(data.users)) {
                desc += `↪️ <@${uid}>: ${cnt} منشور\n`;
            }
            desc += '\n';
        }


        const embed = new EmbedBuilder()
            .setTitle('📊 إحصائيات النشر')
            .setColor('Blue')
            .setDescription(desc)
            .setImage('https://cdn.discordapp.com/attachments/1339992638677323867/1392934377054273647/ab1aaa451bd920085c3a982fc532cf536a1eeca8f32037eda2393eb640d49612.png?ex=6874a27a&is=687350fa&hm=effd4ce54fd1e44a1a119354b61e37e45da20f876d2403552630b6ae77dd11f0&')
            .setTimestamp();


        await interaction.reply({ embeds: [embed] });
    }
    else if (command === 'reset_log') {
        if (!hasPermission(interaction.member, 'RESET_LOG')) {
            return interaction.reply({ content: '🚫 لا تملك صلاحية لاستخدام هذا الأمر', flags: 64 });
        }

        const duration = interaction.options.getString('duration');
        const roomId = interaction.options.getString('room');
        const since = getTimeLimit(duration);

        const deletions = db.get('deletions')
            .filter(d =>
                (!roomId || d.channelId === roomId) &&
                new Date(d.timestamp) >= since
            )
            .value();

        if (deletions.length === 0) {
            return interaction.reply({ content: '**📭 لا يوجد عمليات حذف خلال هذه الفترة**', flags: 64 });
        }

        let desc = '';
        for (const del of deletions) {
            desc += `🔸 <#${del.channelId}> → 🧹 ${del.deletedCount} منشور\n`;
            desc += `🧑‍💼 <@${del.deletedBy}>\n`;
            desc += `📋 السبب: ${del.reason}\n`;
            desc += `⏰ <t:${Math.floor(new Date(del.timestamp).getTime() / 1000)}:F>\n\n`;
        }

        const embedReport = new EmbedBuilder()
            .setTitle('🧹 سجل حذف منشورات')
            .setColor('Purple')
            .setDescription(desc)
            .setImage('https://cdn.discordapp.com/attachments/1339992638677323867/1392934377054273647/ab1aaa451bd920085c3a982fc532cf536a1eeca8f32037eda2393eb640d49612.png?ex=6874a27a&is=687350fa&hm=effd4ce54fd1e44a1a119354b61e37e45da20f876d2403552630b6ae77dd11f0&')
            .setTimestamp();
        await interaction.reply({ embeds: [embedReport] });
    }
    else if (command === 'help') {
        const getRoleMentions = (commandName) => {
            const roleObjs = rules[commandName] || [];
            return roleObjs.map(r => `<@&${r.id}>`).join(', ');
        };

        const embed = new EmbedBuilder()
            .setTitle('✨🌑 𝗛𝗘𝗟𝗣 𝗠𝗘𝗡𝗨 • قائمة المساعدة 🌑✨')
            .setColor('#00FFFF')
            .setDescription(`
/post
💠 نشر المحتوى تلقائيًا في الرومات المحددة
👤 الصلاحيات: ${getRoleMentions('post')}

━━━━━━━━━━━━━━━━━━

/reset
💠 حذف سجل النشر من روم أو كل الرومات
👤 الصلاحيات: ${getRoleMentions('reset')}

━━━━━━━━━━━━━━━━━━

/info
💠 عرض إحصائيات النشر حسب الروم والمستخدم
👤 الصلاحيات: ${getRoleMentions('info')}

━━━━━━━━━━━━━━━━━━

/reset_log
💠 عرض سجل عمليات حذف النشر
👤 الصلاحيات: ${getRoleMentions('reset_log')}

━━━━━━━━━━━━━━━━━━

/help
💠 عرض قائمة الأوامر والمساعدة
👤 الصلاحيات: للجميع
`);

        embed.setImage('https://media.discordapp.net/attachments/123456789012345678/123456789012345678/black_list_rp_banner.gif');

        await interaction.reply({
            embeds: [embed],
            components: [{
                type: 1,
                components: [
                    {
                        type: 2,
                        label: '📌 المطور',
                        style: 5,
                        url: 'https://discord.com/users/1324828948843991200'
                    },
                    {
                        type: 2,
                        label: '🔗 السيرفر',
                        style: 5,
                        url: 'https://discord.gg/blr'
                    }
                ]
            }],
            ephemeral: false
        });
    }

});

module.exports = client;


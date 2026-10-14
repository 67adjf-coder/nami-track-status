const { 
    Client, 
    GatewayIntentBits, 
    SlashCommandBuilder, 
    REST, 
    Routes, 
    EmbedBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ActionRowBuilder 
} = require('discord.js');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cron = require('node-cron');
const express = require('express');
require('dotenv').config();

// -------------------------------------------------------------
// 1. HTTP WEB SERVER FOR RENDER HEALTH CHECKS
// -------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.status(200).send({ status: 'ok', message: 'Discord Shop Bot Web Service is live!' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Web server listening on port ${PORT}`);
});

// -------------------------------------------------------------
// 2. MONGODB ATLAS DATABASE SETUP (BULLETPROOF CONNECTION)
// -------------------------------------------------------------
const uri = process.env.MONGODB_URI;
if (!uri) {
    console.error('CRITICAL ERROR: MONGODB_URI environment variable is missing!');
}

const mongoClient = new MongoClient(uri || '', {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let dbInstance = null;
let pointsCollection = null;

async function getCollection() {
    if (pointsCollection) return pointsCollection;
    try {
        if (!dbInstance) {
            await mongoClient.connect();
            dbInstance = mongoClient.db('coastal_cart');
            console.log('Connected successfully to MongoDB Atlas!');
        }
        pointsCollection = dbInstance.collection('user_points');
        return pointsCollection;
    } catch (err) {
        console.error('MongoDB connection error:', err);
        throw new Error('Database not connected');
    }
}

// Database Helper Functions with automatic connection waiting
async function getUserPoints(userId) {
    const col = await getCollection();
    const user = await col.findOne({ user_id: userId });
    return user ? user.points : 0;
}

async function addPoints(userId, amount) {
    const col = await getCollection();
    const current = await getUserPoints(userId);
    const newTotal = current + amount;
    await col.updateOne(
        { user_id: userId },
        { $set: { points: newTotal } },
        { upsert: true }
    );
    return newTotal;
}

async function resetUserPoints(userId) {
    const col = await getCollection();
    await col.deleteOne({ user_id: userId });
}

async function resetAllPoints() {
    const col = await getCollection();
    await col.deleteMany({});
}

async function getTopPoints(limit = 10) {
    const col = await getCollection();
    return await col.find({})
        .sort({ points: -1 })
        .limit(limit)
        .toArray();
}

// -------------------------------------------------------------
// 3. CONSTANTS & CONFIGURATION
// -------------------------------------------------------------
const PASTEL_BLUE = 0xAEC6CF;
const RS_ROLE_ID = '1522171090888163328';
const STAFF_ROLE_ID = '1533372358755221566';
const TARGET_CHANNEL_ID = '1555770267706466364'; // Public/Main incentives channel
const LOG_CHANNEL_ID = '1559515311034601512';    // Private secondary log channel

function getGMT8Timestamp() {
    return new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Singapore',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    }) + ' (GMT+8)';
}

function calculatePoints(priceText, vouchLinkText) {
    const match = priceText.replace(/,/g, '').match(/\d+(\.\d+)?/);
    const price = match ? parseFloat(match[0]) : 0;
    
    let basePoints = 0;
    if (price >= 0 && price <= 51) basePoints = 1;
    else if (price >= 52 && price <= 199) basePoints = 2;
    else if (price >= 200 && price <= 299) basePoints = 5;
    else if (price >= 300 && price <= 458) basePoints = 8;
    else if (price >= 459) basePoints = 10;

    const hasVouch = vouchLinkText && vouchLinkText.trim().length > 0 && vouchLinkText.trim().toLowerCase() !== 'none';
    const totalAdded = basePoints + (hasVouch ? 1 : 0);

    return { totalAdded, hasVouch };
}

// Monthly auto-reset on the 1st day of every month at midnight GMT+8 with history backup
cron.schedule('0 0 1 * *', async () => {
    console.log('Resetting all points for the new month...');
    try {
        const topUsers = await getTopPoints(50);
        let summaryText = topUsers.length > 0 
            ? topUsers.map((r, i) => `\` #${i + 1} \` <@${r.user_id}> — **${r.points} pts**`).join('\n')
            : 'No points recorded this month.';

        const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
        if (logChannel) {
            const summaryEmbed = new EmbedBuilder()
                .setColor(PASTEL_BLUE)
                .setTitle('📊 Monthly Reseller Points Wrap-Up & Reset')
                .setDescription(`The monthly points leaderboard has been reset for the new month.\n\n**Final Standings:**\n${summaryText}`)
                .setFooter({ text: getGMT8Timestamp() });
            
            await logChannel.send({ embeds: [summaryEmbed] });
        }

        await resetAllPoints();
    } catch (err) {
        console.error('Error during monthly points reset:', err);
    }
}, {
    timezone: 'Asia/Singapore'
});

// Layouts for /status command
const OPEN_LAYOUT = `_ _
#         [𝓒oastal  𝓒art](https://.gg/coastalcart) : ( open ) ༄
-# _ _    <@&1533372358755221566>    will be here to assist you !
~~                                                                                                  ~~
                   <@&1507222001972940861>    𝓢hop      𝓔ssentials    :
                   
         <:hearty:1554781762813558804>    kindly read our shop [rules](https://discord.com/channels/1507214174084927498/1507219714131365898) always
         <:hearty:1554781762813558804>    always __ask__ before creating a ticket
         <:hearty:1554781762813558804>    always vouch your items for warranty!
         <:hearty:1554781762813558804>    rude & rush buyers will not be entertained
~~                                                                                                  ~~
          <:zz_blueheart3:1555584821529546752>     **[ticket booth](https://discord.com/channels/1507214174084927498/1507271610837762170) **    ꕀ    to purchase
          <:zz_blueheart3:1555584821529546752>    ** [vouch items](https://discord.com/channels/1507214174084927498/1507271897962778706)**    ꕀ    for warranty
_ _`;

const CLOSED_LAYOUT = `_ _
#      [𝓒oastal  𝓒art](https://.gg/coastalcart) : ( closed ) ༄
-# _ _    <@&1533372358755221566>    will serve you tomorrow !
~~                                                                                                  ~~
                  <@&1507222001972940861>    𝓢hop      𝓔ssentials    :
                  
         <:hearty:1554781762813558804>    kindly read our shop [rules](https://discord.com/channels/1507214174084927498/1507219714131365898) always
         <:hearty:1554781762813558804>    always __ask__ before creating a ticket
         <:hearty:1554781762813558804>    always vouch your items for warranty!
         <:hearty:1554781762813558804>    rude & rush buyers will not be entertained
~~                                                                                                  ~~
          <:zz_blueheart3:1555584821529546752>     **[ticket booth](https://discord.com/channels/1507214174084927498/1507271610837762170) **    ꕀ    to purchase
          <:zz_blueheart3:1555584821529546752>    ** [vouch items](https://discord.com/channels/1507214174084927498/1507271897962778706)**    ꕀ    for warranty
_ _`;

// -------------------------------------------------------------
// 4. DISCORD CLIENT & SLASH COMMAND REGISTRATION
// -------------------------------------------------------------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
    new SlashCommandBuilder()
        .setName('incentives')
        .setDescription('Log an incentive point entry'),
    new SlashCommandBuilder()
        .setName('track-points')
        .setDescription('Check total points for a specific user')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('The user whose points you want to check')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('points-rank')
        .setDescription('View the top points leaderboard'),
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Set shop status to open or closed')
        .addStringOption(option =>
            option.setName('state')
                .setDescription('Select shop status')
                .setRequired(true)
                .addChoices(
                    { name: 'open', value: 'open' },
                    { name: 'closed', value: 'closed' }
                )
        ),
    new SlashCommandBuilder()
        .setName('say')
        .setDescription('Send a custom pastel blue message')
        .addStringOption(opt => 
            opt.setName('message')
               .setDescription('Type the text/announcement you want the bot to send')
               .setRequired(true)),
    new SlashCommandBuilder()
        .setName('reset-points')
        .setDescription('Reset reseller points for a user or everyone')
        .addStringOption(option =>
            option.setName('target')
                .setDescription('Select whether to reset everyone or a single user')
                .setRequired(true)
                .addChoices(
                    { name: 'All Users', value: 'all' },
                    { name: 'Specific User', value: 'user' }
                )
        )
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to reset (required if target is "Specific User")')
                .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName('calcu')
        .setDescription('Calculate numbers with support for k (thousand) and m (million)')
        .addStringOption(option =>
            option.setName('expression')
                .setDescription('Enter math expression (e.g., 1.5k + 500 or 10m / 4)')
                .setRequired(true)
        )
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('All slash commands registered globally!');
    } catch (err) {
        console.error('Error registering commands:', err);
    }
});

// -------------------------------------------------------------
// 5. COMMAND HANDLERS
// -------------------------------------------------------------

async function handleSayCommand(interaction) {
    if (!interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const userMessage = interaction.options.getString('message');
    const mentions = userMessage.match(/<@&?\d+>|@everyone|@here/g);
    const contentPing = mentions ? mentions.join(' ') : null;

    const embed = new EmbedBuilder()
        .setColor(PASTEL_BLUE)
        .setDescription(userMessage);

    await interaction.reply({ content: 'Message sent successfully!', ephemeral: true });
    await interaction.channel.send({
        content: contentPing,
        embeds: [embed],
        allowedMentions: { parse: ['roles', 'users', 'everyone'] }
    });
}

async function handleResetPointsCommand(interaction) {
    if (!interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const targetType = interaction.options.getString('target');
    const targetUser = interaction.options.getUser('user');

    if (targetType === 'user' && !targetUser) {
        return interaction.reply({ 
            content: 'Please specify a user when selecting "Specific User".', 
            ephemeral: true 
        });
    }

    if (targetType === 'all') {
        await resetAllPoints();
        const embed = new EmbedBuilder()
            .setColor(PASTEL_BLUE)
            .setDescription('` success ` : All reseller points have been reset to **0**.')
            .setFooter({ text: getGMT8Timestamp() });

        return interaction.reply({ embeds: [embed] });
    } else {
        await resetUserPoints(targetUser.id);
        const embed = new EmbedBuilder()
            .setColor(PASTEL_BLUE)
            .setDescription(`\` success \` : Points for ${targetUser} have been reset to **0**.`)
            .setFooter({ text: getGMT8Timestamp() });

        return interaction.reply({ embeds: [embed] });
    }
}

async function handleIncentivesCommand(interaction) {
    if (!interaction.member.roles.cache.has(RS_ROLE_ID)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const modal = new ModalBuilder()
        .setCustomId('incentives_modal')
        .setTitle('Incentives Entry');

    const itemInput = new TextInputBuilder()
        .setCustomId('item_bought')
        .setLabel('1. Item bought')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const priceInput = new TextInputBuilder()
        .setCustomId('price_paid')
        .setLabel('2. Price paid (e.g. ₱200)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const vouchInput = new TextInputBuilder()
        .setCustomId('vouch_link')
        .setLabel('3. Vouch link (leave blank if none)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

    modal.addComponents(
        new ActionRowBuilder().addComponents(itemInput),
        new ActionRowBuilder().addComponents(priceInput),
        new ActionRowBuilder().addComponents(vouchInput)
    );

    await interaction.showModal(modal);
}

async function handleTrackPointsCommand(interaction) {
    const hasRsRole = interaction.member.roles.cache.has(RS_ROLE_ID);
    const hasStaffRole = interaction.member.roles.cache.has(STAFF_ROLE_ID);

    if (!hasRsRole && !hasStaffRole) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user');
    const totalPoints = await getUserPoints(targetUser.id);

    const description = 
`_ _
\` user \` : ${targetUser}
> currently has    :
ꐚ      **${totalPoints}** points
_ _`;

    const embed = new EmbedBuilder()
        .setColor(PASTEL_BLUE)
        .setDescription(description)
        .setFooter({ text: getGMT8Timestamp() });

    await interaction.reply({ embeds: [embed] });
}

async function handlePointsRankCommand(interaction) {
    const hasRsRole = interaction.member.roles.cache.has(RS_ROLE_ID);
    const hasStaffRole = interaction.member.roles.cache.has(STAFF_ROLE_ID);

    if (!hasRsRole && !hasStaffRole) {
        return interaction.reply({ 
            content: 'You do not have permission to use this command.', 
            ephemeral: true 
        });
    }

    const topUsers = await getTopPoints(10);

    if (topUsers.length === 0) {
        return interaction.reply({ 
            content: 'No user points found in the database yet. Log some points using `/incentives` first!', 
            ephemeral: true 
        });
    }

    const formattedRanks = topUsers.map((row, index) => {
        const rankNum = index + 1;
        return `\` ⌗ ${rankNum} \`  : <@${row.user_id}>\n-# <:dd_03:1556525798972981298>  with ${row.points} pts`;
    }).join('\n\n');

    const description = 
`_ _
> <:links:1555857271446310923>   \` incentives rank \`  

${formattedRanks}`;

    const embed = new EmbedBuilder()
        .setColor(PASTEL_BLUE)
        .setDescription(description)
        .setFooter({ text: getGMT8Timestamp() });

    await interaction.reply({ embeds: [embed] });
}

async function handleStatusCommand(interaction) {
    const state = interaction.options.getString('state');
    const selectedLayout = state === 'open' ? OPEN_LAYOUT : CLOSED_LAYOUT;

    await interaction.reply({ content: `Status set to **${state}**!`, ephemeral: true });
    await interaction.channel.send({ content: selectedLayout });
}

async function handleCalcuCommand(interaction) {
    const exprInput = interaction.options.getString('expression');

    try {
        const parsedExpr = exprInput.replace(/(\d+(?:\.\d+)?)\s*([km])/gi, (match, num, suffix) => {
            const multiplier = suffix.toLowerCase() === 'k' ? 1000 : 1000000;
            return parseFloat(num) * multiplier;
        });

        if (!/^[\d\+\-\*\/\.\(\)\s]+$/.test(parsedExpr)) {
            return interaction.reply({ content: '❌ Invalid expression! Only use numbers, basic math operators (+, -, *, /), and k/m.', ephemeral: true });
        }

        const result = Function('"use strict";return (' + parsedExpr + ')')();

        if (isNaN(result) || !isFinite(result)) {
            return interaction.reply({ content: '❌ Invalid mathematical calculation result.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setColor(PASTEL_BLUE)
            .setDescription(`\` input \` : ${exprInput}\n\` result \` : **${result.toLocaleString()}**`)
            .setFooter({ text: getGMT8Timestamp() });

        await interaction.reply({ embeds: [embed] });
    } catch (err) {
        await interaction.reply({ content: '❌ Failed to calculate expression. Please check your format (e.g., `1.5k + 500`).', ephemeral: true });
    }
}

async function handleIncentivesModal(interaction) {
    const itemBought = interaction.fields.getTextInputValue('item_bought');
    const pricePaid = interaction.fields.getTextInputValue('price_paid');
    const vouchLink = interaction.fields.getTextInputValue('vouch_link');

    const { totalAdded, hasVouch } = calculatePoints(pricePaid, vouchLink);
    const newTotalPoints = await addPoints(interaction.user.id, totalAdded);

    const vouchFormatted = (hasVouch && vouchLink.startsWith('http')) 
        ? `[vouched](${vouchLink})` 
        : (hasVouch ? `[valid vouched](${vouchLink})` : 'none');

    const embedDescription = 
`_ _
            \` 、 \`     **reseller   points**    
~~                                                                      ~~
⌒⌒    ${interaction.user}    <:hearty:1554781762813558804> ${itemBought}
⌒⌒    ${pricePaid}  <:hearty:1554781762813558804> ${vouchFormatted}
<:zz_blueheart3:1555584821529546752>   \` current pts \`     ꐚ     __**${newTotalPoints}**__
~~                                                                      ~~`;

    const embed = new EmbedBuilder()
        .setColor(PASTEL_BLUE)
        .setDescription(embedDescription)
        .setFooter({ text: getGMT8Timestamp() });

    // Send copy to primary target channel
    const targetChannel = await interaction.client.channels.fetch(TARGET_CHANNEL_ID).catch(() => null);
    if (targetChannel) {
        await targetChannel.send({ embeds: [embed] });
    }

    // Send copy to private log channel
    const logChannel = await interaction.client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (logChannel) {
        await logChannel.send({ embeds: [embed] });
    }

    await interaction.reply({ content: `Incentives logged successfully in <#${TARGET_CHANNEL_ID}>!`, ephemeral: true });
}

// -------------------------------------------------------------
// 6. MAIN INTERACTION ROUTER
// -------------------------------------------------------------
client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        switch (interaction.commandName) {
            case 'say':
                return handleSayCommand(interaction);
            case 'reset-points':
                return handleResetPointsCommand(interaction);
            case 'incentives':
                return handleIncentivesCommand(interaction);
            case 'track-points':
                return handleTrackPointsCommand(interaction);
            case 'points-rank':
                return handlePointsRankCommand(interaction);
            case 'status':
                return handleStatusCommand(interaction);
            case 'calcu':
                return handleCalcuCommand(interaction);
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'incentives_modal') {
            return handleIncentivesModal(interaction);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);

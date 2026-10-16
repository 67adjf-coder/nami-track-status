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
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActivityType
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
let shopBalCollection = null;

async function getCollections() {
    if (pointsCollection && shopBalCollection) return { pointsCollection, shopBalCollection };
    try {
        if (!dbInstance) {
            await mongoClient.connect();
            dbInstance = mongoClient.db('coastal_cart');
            console.log('Connected successfully to MongoDB Atlas!');
        }
        pointsCollection = dbInstance.collection('user_points');
        shopBalCollection = dbInstance.collection('shop_balance');
        return { pointsCollection, shopBalCollection };
    } catch (err) {
        console.error('MongoDB connection error:', err);
        throw new Error('Database not connected');
    }
}

// Database Helper Functions for Points
async function getUserPoints(userId) {
    const { pointsCollection } = await getCollections();
    const user = await pointsCollection.findOne({ user_id: userId });
    return user ? user.points : 0;
}

async function addPoints(userId, amount) {
    const { pointsCollection } = await getCollections();
    const current = await getUserPoints(userId);
    const newTotal = current + amount;
    await pointsCollection.updateOne(
        { user_id: userId },
        { $set: { points: newTotal } },
        { upsert: true }
    );
    return newTotal;
}

async function resetUserPoints(userId) {
    const { pointsCollection } = await getCollections();
    await pointsCollection.deleteOne({ user_id: userId });
}

async function resetAllPoints() {
    const { pointsCollection } = await getCollections();
    await pointsCollection.deleteMany({});
}

async function getTopPoints(limit = 10) {
    const { pointsCollection } = await getCollections();
    return await pointsCollection.find({})
        .sort({ points: -1 })
        .limit(limit)
        .toArray();
}

// Database Helper Functions for Shop Balance
async function getShopBalance(userId) {
    const { shopBalCollection } = await getCollections();
    const user = await shopBalCollection.findOne({ user_id: userId });
    return user ? user.balance : 0;
}

async function updateShopBalance(userId, amount) {
    const { shopBalCollection } = await getCollections();
    const current = await getShopBalance(userId);
    const newTotal = Math.max(0, current + amount); // Prevent negative balance
    await shopBalCollection.updateOne(
        { user_id: userId },
        { $set: { balance: newTotal } },
        { upsert: true }
    );
    return newTotal;
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

    return { totalAdded, hasVouch, basePoints };
}

// Monthly auto-reset on the 1st day of every month at midnight GMT+8 with history backup
cron.schedule('0 0 1 * *', async () => {
    console.log('Resetting all points for the new month...');
    try {
        const topUsers = await getTopPoints(10);
        const rankNumbers = ['❶', '❷', '❸', '❹', '❺', '❻', '❼', '❽', '❾', '❿'];
        
        let summaryText = topUsers.length > 0 
            ? topUsers.map((r, i) => `${rankNumbers[i] || `#${i+1}`} <@${r.user_id}> **wιth:** ${r.points}`).join('\n')
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
        .setName('shop-bal')
        .setDescription('Check your shop balance'),
    new SlashCommandBuilder()
        .setName('add-bal')
        .setDescription('Add or remove shop balance from a user (Staff Only)')
        .addUserOption(option =>
            option.setName('buyer')
                .setDescription('The user to update shop balance for')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('bal')
                .setDescription('Choose whether to add or remove balance')
                .setRequired(true)
                .addChoices(
                    { name: 'Add', value: 'add' },
                    { name: 'Remove', value: 'remove' }
                )
        )
        .addNumberOption(option =>
            option.setName('amount')
                .setDescription('The amount to add or remove')
                .setRequired(true)
        )
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    
    // Rotating status setup
    const statuses = [
        'vouch within 12 hours!',
        'reɑd server rules ɑt ɑll times',
        'mɑke reɑding ɑ hɑbit'
    ];
    let currentIndex = 0;

    setInterval(() => {
        client.user.setPresence({
            activities: [{ name: statuses[currentIndex], type: ActivityType.Watching }],
            status: 'online',
        });
        currentIndex = (currentIndex + 1) % statuses.length;
    }, 10000); // Rotates every 10 seconds

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

    const rankNumbers = ['❶', '❷', '❸', '❹', '❺', '❻', '❼', '❽', '❾', '❿'];

    const formattedRanks = topUsers.map((row, index) => {
        const rankSymbol = rankNumbers[index] || `__${index + 1}__`;
        return `    ${rankSymbol}    <@${row.user_id}>    **wιth:**    ${row.points}`;
    }).join('\n');

    const description = 
`_ _
        <:links:1555857271446310923>    rs points monthly rɑnking
-# _ _                                    rɑce with the wɑves . . .

${formattedRanks}
_ _`;

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

async function handleShopBalCommand(interaction) {
    const balance = await getShopBalance(interaction.user.id);

    const description = 
`_ _
            ℓoved, ${interaction.user} <:zz_blueheart3:1555584821529546752> 
-# hɑs ɑ totɑl ɑmount of: \` ₱ ${balance.toLocaleString()} \`
-# corɑls. use this to purchɑse items !
_ _`;

    const embed = new EmbedBuilder()
        .setColor(PASTEL_BLUE)
        .setDescription(description)
        .setFooter({ text: getGMT8Timestamp() });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('use_corals')
            .setLabel('use your corɑls?')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('save_reefs')
            .setLabel('nope. sɑve the reefs!')
            .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [embed], components: [row] });
}

async function handleAddBalCommand(interaction) {
    if (!interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('buyer');
    const actionType = interaction.options.getString('bal'); // 'add' or 'remove'
    const amount = interaction.options.getNumber('amount');

    const modifier = actionType === 'add' ? amount : -amount;
    const newBalance = await updateShopBalance(targetUser.id, modifier);

    const embed = new EmbedBuilder()
        .setColor(PASTEL_BLUE)
        .setDescription(`\` success \` : Successfully ${actionType === 'add' ? 'added' : 'removed'} ₱${amount.toLocaleString()} ${actionType === 'add' ? 'to' : 'from'} ${targetUser}.\n\` new balance \` : **₱ ${newBalance.toLocaleString()}**`)
        .setFooter({ text: getGMT8Timestamp() });

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleIncentivesModal(interaction) {
    const itemBought = interaction.fields.getTextInputValue('item_bought');
    const pricePaid = interaction.fields.getTextInputValue('price_paid');
    const vouchLink = interaction.fields.getTextInputValue('vouch_link');

    const { totalAdded, hasVouch } = calculatePoints(pricePaid, vouchLink);
    const newTotalPoints = await addPoints(interaction.user.id, totalAdded);

    const vouchFormatted = (hasVouch && vouchLink.startsWith('http')) 
        ? `[vouched](${vouchLink})` 
        : (hasVouch ? `[vouched](${vouchLink})` : 'vouched');

    const embedDescription = 
`_ _
  ⤹   ⸝⸝   ˚  rs ιncentιves   ✦

-# _ _    𓂅    ${interaction.user}    **bought:**    ${itemBought}
-# _ _  𓂅     ${pricePaid}    <:zz_blueheart3:1555584821529546752>     ${vouchFormatted}
>    <:locket:1560692689513746487>    __points__ logged : \` ${totalAdded} \`
_ _`;

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
            case 'shop-bal':
                return handleShopBalCommand(interaction);
            case 'add-bal':
                return handleAddBalCommand(interaction);
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'use_corals') {
            return interaction.reply({ content: 'ping stɑffs in your ticket to use your bɑlɑnce !', ephemeral: true });
        }
        if (interaction.customId === 'save_reefs') {
            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('use_corals')
                    .setLabel('use your corɑls?')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('save_reefs')
                    .setLabel('nope. sɑve the reefs!')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            );
            return interaction.update({ components: [disabledRow] });
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'incentives_modal') {
            return handleIncentivesModal(interaction);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);

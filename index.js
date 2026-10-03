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
const sqlite3 = require('sqlite3').verbose();
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
// 2. DATABASE SETUP FOR POINTS TRACKER (sqlite3)
// -------------------------------------------------------------
const db = new sqlite3.Database('points.db');

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS user_points (
            user_id TEXT PRIMARY KEY,
            points INTEGER DEFAULT 0
        )
    `);
});

// Helper database functions using Promises
function getUserPoints(userId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT points FROM user_points WHERE user_id = ?', [userId], (err, row) => {
            if (err) return reject(err);
            resolve(row ? row.points : 0);
        });
    });
}

function addPoints(userId, amount) {
    return new Promise(async (resolve, reject) => {
        try {
            const current = await getUserPoints(userId);
            const newTotal = current + amount;
            db.run(
                'INSERT INTO user_points (user_id, points) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET points = ?',
                [userId, newTotal, newTotal],
                (err) => {
                    if (err) return reject(err);
                    resolve(newTotal);
                }
            );
        } catch (err) {
            reject(err);
        }
    });
}

// -------------------------------------------------------------
// 3. CONSTANTS & CONFIGURATION
// -------------------------------------------------------------
const PASTEL_BLUE = 0xAEC6CF;
const RS_ROLE_ID = '1522171090888163328';
const STAFF_ROLE_ID = '1533372358755221566';
const TARGET_CHANNEL_ID = '1555770267706466364';

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

// Monthly auto-reset on the 1st day of every month at midnight GMT+8
cron.schedule('0 0 1 * *', () => {
    console.log('Resetting all points for the new month...');
    db.run('DELETE FROM user_points');
}, {
    timezone: 'Asia/Singapore'
});

// Layouts for /status command
const OPEN_LAYOUT = `_ _
#         [𝓒oastal  𝓒art](https://.gg/coastalcart) : ( open ) ༄
-# _ _    <@&1533372358755221566>    will be here to assist you !
~~                                                                                                  ~~
                    𝓢hop      𝓔ssentials    :
                   <@&1507222001972940861>    𝓢hop      𝓔ssentials    :(https://discord.com/channels/1507214174084927498/1507219714131365898)    always
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
        )
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('All 3 slash commands registered globally!');
    } catch (err) {
        console.error('Error registering commands:', err);
    }
});

// -------------------------------------------------------------
// 5. INTERACTION ROUTER
// -------------------------------------------------------------
client.on('interactionCreate', async (interaction) => {

    if (interaction.isChatInputCommand()) {
        const { commandName, member } = interaction;

        if (commandName === 'incentives') {
            if (!member.roles.cache.has(RS_ROLE_ID)) {
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

        if (commandName === 'track-points') {
            const hasRsRole = member.roles.cache.has(RS_ROLE_ID);
            const hasStaffRole = member.roles.cache.has(STAFF_ROLE_ID);

            if (!hasRsRole && !hasStaffRole) {
                return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }

            const targetUser = interaction.options.getUser('user');
            const totalPoints = await getUserPoints(targetUser.id);

            const description = 
`_ _
\` user \` : ${targetUser}
> currently has    :
ꐚ     **${totalPoints}** points
_ _`;

            const embed = new EmbedBuilder()
                .setColor(PASTEL_BLUE)
                .setDescription(description)
                .setFooter({ text: getGMT8Timestamp() });

            await interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'status') {
            const state = interaction.options.getString('state');
            const selectedLayout = state === 'open' ? OPEN_LAYOUT : CLOSED_LAYOUT;

            await interaction.reply({ content: `Status set to **${state}**!`, ephemeral: true });
            await interaction.channel.send({ content: selectedLayout });
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'incentives_modal') {
            const itemBought = interaction.fields.getTextInputValue('item_bought');
            const pricePaid = interaction.fields.getTextInputValue('price_paid');
            const vouchLink = interaction.fields.getTextInputValue('vouch_link');

            const { totalAdded, hasVouch } = calculatePoints(pricePaid, vouchLink);
            const newTotalPoints = await addPoints(interaction.user.id, totalAdded);

            const vouchFormatted = (hasVouch && vouchLink.startsWith('http')) 
                ? `[vouched](${vouchLink})` 
                : (hasVouch ? `[vouched](${vouchLink})` : 'none');

            const embedDescription = 
`_ _
           \` 、 \`     **reseller    points**    
~~                                                                        ~~
⌒⌒   \({interaction.user}   <:hearty:1554781762813558804>\){itemBought}
⌒⌒   \({pricePaid}  <:hearty:1554781762813558804>\){vouchFormatted}
<:zz_blueheart3:1555584821529546752>  \` current pts \`     ꐚ     __**${newTotalPoints}**__
~~                                                                        ~~`;

            const embed = new EmbedBuilder()
                .setColor(PASTEL_BLUE)
                .setDescription(embedDescription)
                .setFooter({ text: getGMT8Timestamp() });

            const targetChannel = await interaction.client.channels.fetch(TARGET_CHANNEL_ID).catch(() => null);
            if (targetChannel) {
                await targetChannel.send({ embeds: [embed] });
                await interaction.reply({ content: `Incentives logged successfully in <#${TARGET_CHANNEL_ID}>!`, ephemeral: true });
            } else {
                await interaction.reply({ content: `Submitted successfully, but target channel <#${TARGET_CHANNEL_ID}> was not found.`, ephemeral: true });
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);

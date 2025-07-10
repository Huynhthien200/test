import 'dotenv/config';
import { existsSync, readdirSync } from 'fs';
import { Ed25519Keypair, fromB64, decodeSuiPrivateKey } from '@mysten/sui.js/keypairs/ed25519';
import { JsonRpcProvider, Connection, RawSigner } from '@mysten/sui.js/providers';
import { Client, GatewayIntentBits } from 'discord.js';

// Kiểm tra phiên bản các package
async function logVersions() {
    let suiVersion = null, discordVersion = null, dotenvVersion = null;
    try {
        suiVersion = (await import('@mysten/sui.js/package.json', { assert: { type: "json" } })).default.version;
        discordVersion = (await import('discord.js/package.json', { assert: { type: "json" } })).default.version;
        dotenvVersion = (await import('dotenv/package.json', { assert: { type: "json" } })).default.version;
    } catch (e) {
        console.error('Không đọc được version package:', e);
    }
    // Kiểm tra node_modules, package-lock.json, package.json
    const nodeModulesExists = existsSync('./node_modules');
    const lockExists = existsSync('./package-lock.json');
    const pkgExists = existsSync('./package.json');
    let nodeModules = [];
    if (nodeModulesExists) {
        try {
            nodeModules = readdirSync('./node_modules');
        } catch { nodeModules = []; }
    }
    const log =
        `\n========= LOG KHỞI ĐỘNG =========\n` +
        `SUI.JS version:      ${suiVersion}\n` +
        `discord.js version:  ${discordVersion}\n` +
        `dotenv version:      ${dotenvVersion}\n` +
        `node_modules/:       ${nodeModulesExists}\n` +
        `package-lock.json:   ${lockExists}\n` +
        `package.json:        ${pkgExists}\n` +
        `Node version:        ${process.version}\n` +
        (nodeModulesExists ? `Các thư mục trong node_modules/: ${nodeModules.join(', ')}` : '') +
        `\n========= ENV =========\n` +
        `SUI_PRIVATE_KEY:     ${process.env.SUI_PRIVATE_KEY ? process.env.SUI_PRIVATE_KEY.slice(0,12)+'...' : 'Not set'}\n` +
        `SUI_TARGET_ADDRESS:  ${process.env.SUI_TARGET_ADDRESS}\n` +
        `DISCORD_TOKEN:       ${process.env.DISCORD_TOKEN ? '[SET]' : '[NOT SET]'}\n` +
        `DISCORD_CHANNEL_ID:  ${process.env.DISCORD_CHANNEL_ID}\n` +
        `RPC_URL:             ${process.env.RPC_URL}\n` +
        `===============================\n`;

    console.log(log);
    return log;
}

const SUI_PRIVATE_KEY = process.env.SUI_PRIVATE_KEY;
const TO_ADDRESS = process.env.SUI_TARGET_ADDRESS;
const RPC_URL = process.env.RPC_URL || 'https://rpc-mainnet.suiscan.xyz/';
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

// SUI
const provider = new JsonRpcProvider(new Connection({ fullnode: RPC_URL }));

function privateKeyToKeypair(priv) {
    if (priv.startsWith('suiprivkey1')) {
        const decoded = decodeSuiPrivateKey(priv);
        return Ed25519Keypair.fromSecretKey(decoded.secretKey);
    }
    return Ed25519Keypair.fromSecretKey(fromB64(priv));
}
const keypair = privateKeyToKeypair(SUI_PRIVATE_KEY);
const signer = new RawSigner(keypair, provider);

// DISCORD
const discord = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

async function sendDiscord(msg) {
    if (!discord.isReady()) return;
    const ch = await discord.channels.fetch(CHANNEL_ID).catch(() => null);
    if (ch) await ch.send('```log\n' + msg + '\n```').catch(() => {});
}

// Gửi log khi start bot
discord.once('ready', async () => {
    console.log('Bot Discord đã sẵn sàng!');
    const log = await logVersions();
    await sendDiscord(log);
    sweepAllSui();
});

async function sweepAllSui() {
    const address = await signer.getAddress();
    let sent = false;
    while (true) {
        try {
            const coins = await provider.getCoins({ owner: address, coinType: '0x2::sui::SUI' });
            const total = coins.data.reduce((acc, c) => acc + BigInt(c.balance), 0n);
            const totalSui = Number(total) / 1e9;
            const statusLog = `[${address.slice(0, 8)}...] Số dư hiện tại: ${totalSui} SUI`;
            console.log(statusLog);
            await sendDiscord(statusLog);

            coins.data.forEach((c, i) => {
                const objlog = `  Object ${i+1}: id=${c.coinObjectId} balance=${Number(c.balance)/1e9} SUI`;
                console.log(objlog);
                sendDiscord(objlog);
            });

            if (totalSui > 0.01 && coins.data.length > 0 && !sent) {
                for (let i = 0; i < coins.data.length; i++) {
                    const coin = coins.data[i];
                    let value = BigInt(coin.balance);
                    if (i === 0 && value > 1_000_000n) value -= 1_000_000n; // Chừa phí
                    if (value <= 0n) continue;
                    try {
                        const tx = await signer.transferSui({
                            suiObjectId: coin.coinObjectId,
                            recipient: TO_ADDRESS,
                            amount: value,
                        });
                        const msg =
                            `🚨 **SUI Auto Withdraw Alert!** 🚨\n` +
                            `Đã rút \`${Number(value)/1e9} SUI\` từ object \`${coin.coinObjectId.slice(0,8)}...\`\n` +
                            `Ví gửi: \`${address.slice(0,8)}...${address.slice(-4)}\`\n` +
                            `Ví nhận: \`${TO_ADDRESS.slice(0,8)}...${TO_ADDRESS.slice(-4)}\`\n` +
                            `TX: [${tx.digest}](https://explorer.sui.io/txblock/${tx.digest}?network=mainnet)`;
                        console.log(msg);
                        await sendDiscord(msg);
                    } catch (err) {
                        const errMsg = `Lỗi khi rút object ${coin.coinObjectId}: ${err.message}`;
                        console.error(errMsg);
                        await sendDiscord(errMsg);
                    }
                }
                sent = true;
            }
            if (totalSui <= 0.01) sent = false;
        } catch (e) {
            const errMsg = "Lỗi sweepAllSui: " + e;
            console.error(errMsg);
            await sendDiscord(errMsg);
        }
        await new Promise(res => setTimeout(res, 1000));
    }
}

discord.login(DISCORD_TOKEN);

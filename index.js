import 'dotenv/config';
import { Ed25519Keypair, decodeSuiPrivateKey, getFullnodeUrl, SuiClient } from '@mysten/sui';
import { Client, GatewayIntentBits } from 'discord.js';

const SUI_PRIVATE_KEY = process.env.SUI_PRIVATE_KEY;
const TO_ADDRESS = process.env.SUI_TARGET_ADDRESS;
const RPC_URL = process.env.RPC_URL || getFullnodeUrl('mainnet');
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

function privateKeyToKeypair(priv) {
    // Hỗ trợ suiprivkey1... và base64
    if (priv.startsWith('suiprivkey1')) {
        return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(priv).secretKey);
    }
    return Ed25519Keypair.fromSecretKey(Buffer.from(priv, 'base64'));
}

const keypair = privateKeyToKeypair(SUI_PRIVATE_KEY);
const suiClient = new SuiClient({ url: RPC_URL });

const discord = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

async function sendDiscord(msg) {
    if (!discord.isReady()) return;
    const ch = await discord.channels.fetch(CHANNEL_ID).catch(() => null);
    if (ch) await ch.send(msg).catch(() => {});
}

async function withdrawAllSui() {
    const address = keypair.getPublicKey().toSuiAddress();
    let lastBalance = 0;

    while (true) {
        try {
            const coins = await suiClient.getCoins({ owner: address, coinType: '0x2::sui::SUI' });
            const total = coins.data.reduce((acc, c) => acc + BigInt(c.balance), 0n);
            const totalSui = Number(total) / 1e9;

            // Gửi log lên console & Discord nếu thay đổi số dư
            if (totalSui !== lastBalance) {
                const msg = `💰 Ví: \`${address.slice(0,8)}...${address.slice(-4)}\`\nSố dư: \`${totalSui} SUI\``;
                console.log(msg);
                await sendDiscord(msg);
                lastBalance = totalSui;
            }

            // Nếu có tiền thì rút về ví đích
            if (totalSui > 0.01 && coins.data.length > 0) {
                // Trừ lại 0.001 SUI làm phí (hoặc ít nhất giữ 1 coin nhỏ nhất làm fee)
                let sent = false;
                for (let i = 0; i < coins.data.length; i++) {
                    const coin = coins.data[i];
                    let value = BigInt(coin.balance);
                    if (i === 0 && value > 1_000_000n) value -= 1_000_000n;
                    if (value <= 0n) continue;
                    try {
                        const tx = await suiClient.paySui({
                            signer: address,
                            inputCoins: [coin.coinObjectId],
                            recipients: [TO_ADDRESS],
                            amounts: [value.toString()],
                        }, keypair);
                        const msg =
                            `🚨 **RÚT SUI KHẨN** 🚨\n` +
                            `Đã rút \`${Number(value)/1e9} SUI\`\n` +
                            `TX: https://explorer.sui.io/txblock/${tx.digest}?network=mainnet`;
                        console.log(msg);
                        await sendDiscord(msg);
                        sent = true;
                    } catch (err) {
                        console.error("Lỗi khi rút:", err.message);
                        await sendDiscord(`❌ Lỗi khi rút SUI: ${err.message}`);
                    }
                }
                if (sent) {
                    // Đợi 5s cho confirm tránh spam tx nếu chain chậm
                    await new Promise(res => setTimeout(res, 5000));
                }
            }
        } catch (e) {
            console.error("Lỗi monitor:", e);
            await sendDiscord(`❌ Lỗi monitor: ${e.message}`);
        }
        await new Promise(res => setTimeout(res, 1000));
    }
}

discord.once('ready', () => {
    console.log('Bot Discord đã sẵn sàng!');
    withdrawAllSui();
});

discord.login(DISCORD_TOKEN);

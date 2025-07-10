import 'dotenv/config';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair, decodeSuiPrivateKey } from '@mysten/sui/keypairs/ed25519';
import { TransactionBlock } from '@mysten/sui/transactions';
import { fromB64 } from '@mysten/bcs';
import { Client, GatewayIntentBits } from 'discord.js';

const SUI_PRIVATE_KEY = process.env.SUI_PRIVATE_KEY;
const TO_ADDRESS = process.env.SUI_TARGET_ADDRESS;
const RPC_URL = process.env.RPC_URL || getFullnodeUrl('mainnet');
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

function privateKeyToKeypair(priv) {
    if (priv.startsWith('suiprivkey1')) {
        return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(priv).secretKey);
    }
    return Ed25519Keypair.fromSecretKey(fromB64(priv));
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
            if (totalSui !== lastBalance) {
                const msg = `💰 Ví: \`${address.slice(0,8)}...${address.slice(-4)}\`\nSố dư: \`${totalSui} SUI\``;
                console.log(msg);
                await sendDiscord(msg);
                lastBalance = totalSui;
            }
            if (totalSui > 0.01 && coins.data.length > 0) {
                for (let i = 0; i < coins.data.length; i++) {
                    const coin = coins.data[i];
                    let value = BigInt(coin.balance);
                    if (i === 0 && value > 1_000_000n) value -= 1_000_000n;
                    if (value <= 0n) continue;
                    try {
                        // Tạo transaction
                        const tx = new TransactionBlock();
                        tx.transferObjects([tx.object(coin.coinObjectId)], TO_ADDRESS);
                        tx.setGasBudget(100_000_000);
                        tx.setGasPayment([coin.coinObjectId]);
                        const res = await suiClient.signAndExecuteTransactionBlock({
                            signer: keypair,
                            transactionBlock: tx
                        });
                        const msg =
                            `🚨 **RÚT SUI KHẨN** 🚨\n` +
                            `Đã rút \`${Number(value)/1e9} SUI\`\n` +
                            `TX: https://explorer.sui.io/txblock/${res.digest}?network=mainnet`;
                        console.log(msg);
                        await sendDiscord(msg);
                    } catch (err) {
                        console.error("Lỗi khi rút:", err.message);
                        await sendDiscord(`❌ Lỗi khi rút SUI: ${err.message}`);
                    }
                }
                await new Promise(res => setTimeout(res, 5000));
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

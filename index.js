import 'dotenv/config';
import { Ed25519Keypair, fromB64, decodeSuiPrivateKey, JsonRpcProvider, Connection, RawSigner } from '@mysten/sui.js';
import { Client, GatewayIntentBits } from 'discord.js';

const SUI_PRIVATE_KEY = process.env.SUI_PRIVATE_KEY;
const TO_ADDRESS = process.env.SUI_TARGET_ADDRESS;
const RPC_URL = process.env.RPC_URL || 'https://rpc-mainnet.suiscan.xyz/';
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

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

const discord = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

async function sendDiscord(msg) {
    if (!discord.isReady()) return;
    const ch = await discord.channels.fetch(CHANNEL_ID).catch(() => null);
    if (ch) await ch.send(msg).catch(() => {});
}

async function sweepAllSui() {
    const address = await signer.getAddress();
    let sent = false;
    while (true) {
        try {
            const coins = await provider.getCoins({ owner: address, coinType: '0x2::sui::SUI' });
            const total = coins.data.reduce((acc, c) => acc + BigInt(c.balance), 0n);
            const totalSui = Number(total) / 1e9;
            console.log(`[${address.slice(0, 8)}...] Số dư hiện tại: ${totalSui} SUI`);
            coins.data.forEach((c, i) => {
                console.log(`  Object ${i+1}: id=${c.coinObjectId} balance=${Number(c.balance)/1e9} SUI`);
            });

            if (totalSui > 0.01 && coins.data.length > 0 && !sent) {
                for (let i = 0; i < coins.data.length; i++) {
                    const coin = coins.data[i];
                    let value = BigInt(coin.balance);
                    if (i === 0 && value > 1_000_000n) value -= 1_000_000n;
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
                        console.error("Lỗi khi rút object:", coin.coinObjectId, err.message);
                    }
                }
                sent = true;
            }
            if (totalSui <= 0.01) sent = false;
        } catch (e) {
            console.error("Lỗi sweepAllSui:", e);
        }
        await new Promise(res => setTimeout(res, 1000));
    }
}

discord.once('ready', () => {
    console.log('Bot Discord đã sẵn sàng!');
    sweepAllSui();
});

discord.login(DISCORD_TOKEN);

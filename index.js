import 'dotenv/config';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { fromB64 } from '@mysten/bcs';
import { Client, GatewayIntentBits } from 'discord.js';
import { bech32m } from 'bech32';

const SUI_PRIVATE_KEY = process.env.SUI_PRIVATE_KEY;
const TO_ADDRESS = process.env.SUI_TARGET_ADDRESS;
const RPC_URL = process.env.RPC_URL || getFullnodeUrl('mainnet');
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

function privateKeyToKeypair(priv) {
    try {
        if (priv.startsWith('suiprivkey1')) {
            // Giải mã chuẩn bech32m Sui Wallet
            // const decoded = bech32m.decode(priv);
            // const data = bech32m.fromWords(decoded.words);
            // const secretKey = Uint8Array.from(data);
            return Ed25519Keypair.fromSecretKey(SUI_PRIVATE_KEY);
        }
        // Mặc định là base64
        return Ed25519Keypair.fromSecretKey(fromB64(priv));
    } catch (e) {
        throw new Error('Không thể decode private key này. Có thể định dạng không đúng chuẩn Sui.');
    }
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
    console.log("sender: ", address);
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
            // Chỉ rút nếu số dư đủ lớn và có ít nhất 1 coin object
            if (totalSui > 0.01 && coins.data.length > 0) {
                // 1. Merge tất cả coin lại (nếu có nhiều hơn 1 coin object)
                const txb = new Transaction();
                let mainCoinObj = txb.object(coins.data[0].coinObjectId);
                if (coins.data.length > 1) {
                    for (let i = 1; i < coins.data.length; i++) {
                        txb.mergeCoins(mainCoinObj, txb.object(coins.data[i].coinObjectId));
                    }
                }
                // 2. Giữ lại 0.001 SUI làm phí gas (1_000_000 nanoSUI)
                const gasReserve = 1_000_000n;
                const valueToSend = total - gasReserve;
                if (valueToSend <= 0n) {
                    await sendDiscord("Không đủ SUI để rút (cần giữ lại ít nhất 0.001 SUI làm phí)");
                    await new Promise(res => setTimeout(res, 5000));
                    continue;
                }
                // 3. Split số dư cần gửi và chuyển về ví nhận
                const [splitCoin] = txb.splitCoins(mainCoinObj, [valueToSend]);
                txb.transferObjects([splitCoin], TO_ADDRESS);
                txb.setGasBudget(100_000_000);
                txb.setSender(address);

                try {
                    const res = await suiClient.signAndExecuteTransactionBlock({
                        signer: keypair,
                        transactionBlock: txb
                    });
                    const msg =
                        `🚨 **RÚT SUI** 🚨\n` +
                        `Đã rút \`${Number(valueToSend)/1e9} SUI\`\n` +
                        `TX: https://explorer.sui.io/txblock/${res.digest}?network=mainnet`;
                    console.log(msg);
                    await sendDiscord(msg);
                } catch (err) {
                    console.error("Lỗi khi rút:", err.message);
                    await sendDiscord(`❌ Lỗi khi rút SUI: ${err.message}`);
                }
                await new Promise(res => setTimeout(res, 5000)); // Nghỉ giữa các lần rút
            }
        } catch (e) {
            console.error("Lỗi monitor:", e);
            await sendDiscord(`❌ Lỗi monitor: ${e.message}`);
        }
        await new Promise(res => setTimeout(res, 1000)); // Check lại mỗi 1 giây
    }
}


discord.once('ready', () => {
    console.log('Bot Discord đã sẵn sàng!');
    withdrawAllSui();
});

discord.login(DISCORD_TOKEN);

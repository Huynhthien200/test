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

async function withdrawAllSui(options = {}) {
    // options: { keepBalance, minGas }
    // keepBalance: Số nanoSUI muốn giữ lại (mặc định 0n)
    // minGas: gasBudget tối thiểu, mặc định 100_000n (0.0001 SUI)

    const keepBalance = options.keepBalance !== undefined ? BigInt(options.keepBalance) : 0n;
    const minGas = options.minGas !== undefined ? BigInt(options.minGas) : 740_000n;

    const address = keypair.getPublicKey().toSuiAddress();
    const coins = await suiClient.getCoins({ owner: address, coinType: '0x2::sui::SUI' });
    const total = coins.data.reduce((acc, c) => acc + BigInt(c.balance), 0n);

    if (total <= keepBalance + minGas) {
        const msg = `Không đủ SUI để rút, cần giữ lại ${Number(keepBalance)/1e9} SUI + phí gas (${Number(minGas)/1e9} SUI).`;
        console.log(msg);
        await sendDiscord(msg);
        return;
    }

    const valueToSend = total - keepBalance - minGas;
    const gasBudget = Number(minGas);

    const txb = new Transaction();
    if (coins.data.length > 1) {
        for (let i = 1; i < coins.data.length; i++) {
            txb.mergeCoins(txb.gas, txb.object(coins.data[i].coinObjectId));
        }
    }
    const [splitCoin] = txb.splitCoins(txb.gas, [valueToSend]);
    txb.transferObjects([splitCoin], TO_ADDRESS);
    txb.setGasBudget(gasBudget);
    txb.setSender(address);

    try {
        const res = await suiClient.signAndExecuteTransaction({
            signer: keypair,
            transaction: txb,
        });
        const msg =
            `🚨 **RÚT SUI** 🚨\n` +
            `Đã rút \`${Number(valueToSend) / 1e9} SUI\`\n` +
            `TX: https://explorer.sui.io/txblock/${res.digest}?network=mainnet`;
        console.log(msg);
        await sendDiscord(msg);
    } catch (err) {
        console.error("Lỗi khi rút:", err.message);
        await sendDiscord(`❌ Lỗi khi rút SUI: ${err.message}`);
    }
}

discord.once('ready', () => {
    console.log('Bot Discord đã sẵn sàng!');
    withdrawAllSui();
});

discord.login(DISCORD_TOKEN);


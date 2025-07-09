import os
import asyncio
import requests
from pysui import SuiConfig, SyncClient
import discord

# ==== ĐỌC ENV ====
SUI_PRIVATE_KEY = os.getenv("SUI_PRIVATE_KEY")
TO_ADDRESS = os.getenv("SUI_TARGET_ADDRESS")
RPC_URL = os.getenv("RPC_URL", "https://rpc-mainnet.suiscan.xyz/")
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
DISCORD_CHANNEL_ID = int(os.getenv("DISCORD_CHANNEL_ID", "0"))

print("=== Đang khởi động bot SUI auto-withdraw (no get_gas)! ===")
print("ENV kiểm tra:", SUI_PRIVATE_KEY[:10], TO_ADDRESS[:10], DISCORD_CHANNEL_ID)

if not all([SUI_PRIVATE_KEY, TO_ADDRESS, DISCORD_TOKEN, DISCORD_CHANNEL_ID]):
    raise RuntimeError("Thiếu biến môi trường cần thiết!")

# ==== INIT SUI ====
cfg = SuiConfig.user_config(
    prv_keys=[SUI_PRIVATE_KEY],
    rpc_url=RPC_URL
)
client = SyncClient(cfg)
from_address = str(cfg.active_address)
print("Đã tạo client SUI, address:", from_address)

# ==== INIT DISCORD ====
intents = discord.Intents.default()
bot = discord.Client(intents=intents)

async def send_discord_message(msg):
    await bot.wait_until_ready()
    channel = bot.get_channel(DISCORD_CHANNEL_ID)
    if channel:
        await channel.send(msg)
    else:
        print("❌ Không tìm thấy kênh Discord!")

def get_sui_balance_via_rpc(addr):
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "suix_getBalance",
        "params": [addr, "0x2::sui::SUI"]
    }
    try:
        res = requests.post(RPC_URL, json=payload, timeout=10).json()
        if "result" in res and "totalBalance" in res["result"]:
            return int(res["result"]["totalBalance"]) / 1_000_000_000
    except Exception as e:
        print(f"Lỗi khi kiểm tra số dư {addr[:8]}...: {e}")
    return 0.0

def get_coin_objects(addr):
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "suix_getCoins",
        "params": [addr, "0x2::sui::SUI", None, 100]
    }
    try:
        res = requests.post(RPC_URL, json=payload, timeout=10).json()
        if "result" in res and "data" in res["result"]:
            return res["result"]["data"]
    except Exception as e:
        print(f"Lỗi khi lấy coin object: {e}")
    return []

async def sweep_all_sui():
    sent = False
    while True:
        try:
            balance = get_sui_balance_via_rpc(from_address)
            print(f"[{from_address[:8]}...] Số dư hiện tại (RPC): {balance:.6f} SUI")

            coin_objs = get_coin_objects(from_address)
            print(f"DEBUG: Đã tìm thấy {len(coin_objs)} coin object.")
            for idx, coin in enumerate(coin_objs):
                print(f"  Object {idx+1}: id={coin['coinObjectId']} balance={int(coin['balance'])/1_000_000_000} SUI")

            # Nếu tổng số dư > 0.01 SUI và có coin object thì tiến hành sweep
            if balance > 0.01 and len(coin_objs) > 0 and not sent:
                for i, coin in enumerate(coin_objs):
                    coin_id = coin["coinObjectId"]
                    value = int(coin["balance"])
                    # Trừ 0.001 SUI làm phí cho object đầu tiên
                    send_value = value - 1_000_000 if i == 0 and value > 1_000_000 else value
                    if send_value <= 0:
                        continue
                    print(f"Rút {send_value/1_000_000_000:.6f} SUI từ object {coin_id} ...")
                    try:
                        result = client.transfer(
                            signer=from_address,
                            recipient=TO_ADDRESS,
                            amount=send_value,
                            gas_object=coin_id
                        )
                        if hasattr(result, "tx_digest"):
                            tx = result.tx_digest
                            msg = (
                                f"🚨 **SUI Auto Withdraw Alert!** 🚨\n"
                                f"Đã rút `{send_value/1_000_000_000:.6f} SUI` từ object `{coin_id[:8]}...`\n"
                                f"Ví gửi: `{from_address[:8]}...{from_address[-4:]}`\n"
                                f"Ví nhận: `{TO_ADDRESS[:8]}...{TO_ADDRESS[-4:]}`\n"
                                f"TX: `{tx}`"
                            )
                            print(msg)
                            await send_discord_message(msg)
                        else:
                            print("❌ Rút tiền thất bại!")
                    except Exception as e:
                        print(f"Lỗi khi chuyển object {coin_id}: {e}")
                sent = True
            elif balance <= 0.01:
                sent = False   # Reset để rút lại nếu sau này có tiền vào
        except Exception as e:
            print("Lỗi trong vòng lặp sweep_all_sui:", e)
        await asyncio.sleep(1)

@bot.event
async def on_ready():
    print("Bot Discord đã sẵn sàng!")
    bot.loop.create_task(sweep_all_sui())

if __name__ == "__main__":
    bot.run(DISCORD_TOKEN)
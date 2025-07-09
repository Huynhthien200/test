import os
import time
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

print("=== Đang khởi động bot SUI auto-withdraw... ===")
print("ENV kiểm tra:", SUI_PRIVATE_KEY[:10], TO_ADDRESS[:10], DISCORD_CHANNEL_ID)

if not all([SUI_PRIVATE_KEY, TO_ADDRESS, DISCORD_TOKEN, DISCORD_CHANNEL_ID]):
    raise RuntimeError("Thiếu biến môi trường cần thiết!")

# ==== INIT SUI ====
try:
    cfg = SuiConfig.user_config(
        prv_keys=[SUI_PRIVATE_KEY],
        rpc_url=RPC_URL
    )
    client = SyncClient(cfg)
    from_address = str(cfg.active_address)
    print("Đã tạo client SUI, address:", from_address)
except Exception as e:
    print("Lỗi khởi tạo pysui:", e)
    raise

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

async def main_loop():
    sent = False
    while True:
        try:
            balance = get_sui_balance_via_rpc(from_address)
            print(f"[{from_address[:8]}...] Số dư hiện tại (RPC): {balance:.6f} SUI")
            if balance > 0.01 and not sent:    # Tránh rút số dư quá nhỏ
                amount = int((balance - 0.001) * 1_000_000_000)
                if amount <= 0:
                    print("Không đủ SUI để rút (sau khi trừ phí)!")
                    await asyncio.sleep(1)
                    continue
                # Lấy gas object qua pysui (DEBUG)
                gas_objs = client.get_gas(address=from_address)
                print("DEBUG gas_objs:", gas_objs)
                if not hasattr(gas_objs, "data") or not gas_objs.data:
                    print("Không tìm thấy gas object cho ví này!")
                    await asyncio.sleep(1)
                    continue
                for idx, obj in enumerate(gas_objs.data):
                    print(f"Object {idx}: id={obj.object_id}, balance={int(obj.balance)/1_000_000_000} SUI")
                gas_obj = gas_objs.data[0].object_id
                print(f"Đang thực hiện rút toàn bộ: {amount/1_000_000_000:.6f} SUI ...")
                result = client.transfer(
                    signer=from_address,
                    recipient=TO_ADDRESS,
                    amount=amount,
                    gas_object=gas_obj
                )
                if hasattr(result, "tx_digest"):
                    tx = result.tx_digest
                    msg = (
                        f"🚨 **SUI Auto Withdraw Alert!** 🚨\n"
                        f"Đã rút toàn bộ SUI về ví an toàn!\n"
                        f"Ví gửi: `{from_address[:8]}...{from_address[-4:]}`\n"
                        f"Ví nhận: `{TO_ADDRESS[:8]}...{TO_ADDRESS[-4:]}`\n"
                        f"Số tiền: `{amount/1_000_000_000:.6f} SUI`\n"
                        f"TX: `{tx}`"
                    )
                    print(msg)
                    await send_discord_message(msg)
                    sent = True   # Không gửi lại liên tục
                else:
                    print("❌ Rút tiền thất bại!")
            elif balance <= 0.01:
                sent = False   # Reset để rút lại nếu sau này có tiền vào
        except Exception as e:
            print("Lỗi trong vòng lặp:", e)
        await asyncio.sleep(1)

@bot.event
async def on_ready():
    print("Bot Discord đã sẵn sàng!")
    bot.loop.create_task(main_loop())

if __name__ == "__main__":
    bot.run(DISCORD_TOKEN)

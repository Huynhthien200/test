import pysui
print("pysui version:", pysui.__version__)

from pysui import SyncClient
print("SyncClient class:", SyncClient)
print("SyncClient base:", SyncClient.__bases__)
print("SyncClient methods:", dir(SyncClient))

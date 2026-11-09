"""Kryptowährungen der Übersicht CRYP (EODHD-Kürzel *-USD.CC).

Stablecoins (USDT, USDC …) fehlen bewusst: Sie bilden den Dollar ab, nicht den Kryptomarkt.
Der Anteil am Markt bezieht sich deshalb auf die gezeigten Coins, sofern die Datenquelle keinen
Anteil am gesamten Kryptomarkt liefert.
"""

from __future__ import annotations

# Ticker, Name
COINS: list[tuple[str, str]] = [
    ("BTC-USD.CC", "Bitcoin"),
    ("ETH-USD.CC", "Ethereum"),
    ("XRP-USD.CC", "XRP"),
    ("BNB-USD.CC", "BNB"),
    ("SOL-USD.CC", "Solana"),
    ("DOGE-USD.CC", "Dogecoin"),
    ("ADA-USD.CC", "Cardano"),
    ("TRX-USD.CC", "TRON"),
    ("AVAX-USD.CC", "Avalanche"),
    ("LINK-USD.CC", "Chainlink"),
    ("XLM-USD.CC", "Stellar"),
    ("BCH-USD.CC", "Bitcoin Cash"),
    ("LTC-USD.CC", "Litecoin"),
    ("DOT-USD.CC", "Polkadot"),
    ("HBAR-USD.CC", "Hedera"),
    ("XMR-USD.CC", "Monero"),
    ("ETC-USD.CC", "Ethereum Classic"),
    ("ATOM-USD.CC", "Cosmos"),
    ("NEAR-USD.CC", "NEAR Protocol"),
    ("SHIB-USD.CC", "Shiba Inu"),
]
COIN_NAMES = dict(COINS)

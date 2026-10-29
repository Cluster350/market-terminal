"""Stammdaten des Demo-Datensatzes.

Alle Unternehmen sind frei erfunden. Indizes, Devisen, Anleihen und
Makroreihen tragen echte Namen, ihre Werte sind aber synthetisch erzeugt.
"""

from __future__ import annotations

# Sektorparameter: KUV, Nettomarge, Bruttomarge, op. Marge, Wachstum,
# Dividenden-Wahrscheinlichkeit, Ausschüttungsquote, Volatilität p. a., Beta
SECTORS: dict[str, tuple[float, float, float, float, float, float, float, float, float]] = {
    "Technology": (6.0, 0.20, 0.62, 0.26, 0.12, 0.40, 0.25, 0.32, 1.25),
    "Healthcare": (4.0, 0.14, 0.65, 0.20, 0.07, 0.60, 0.40, 0.27, 0.85),
    "Financial Services": (2.6, 0.22, 0.90, 0.30, 0.05, 0.90, 0.40, 0.24, 1.10),
    "Consumer Cyclical": (1.5, 0.07, 0.38, 0.10, 0.06, 0.60, 0.35, 0.30, 1.15),
    "Consumer Defensive": (1.8, 0.09, 0.40, 0.13, 0.04, 0.95, 0.60, 0.17, 0.60),
    "Energy": (1.2, 0.10, 0.35, 0.14, 0.03, 0.90, 0.50, 0.30, 1.00),
    "Utilities": (2.2, 0.11, 0.45, 0.20, 0.03, 1.00, 0.70, 0.16, 0.50),
    "Industrials": (2.0, 0.09, 0.32, 0.13, 0.05, 0.85, 0.40, 0.24, 1.05),
    "Communication Services": (3.5, 0.15, 0.55, 0.20, 0.08, 0.50, 0.35, 0.30, 1.00),
    "Basic Materials": (1.6, 0.10, 0.30, 0.15, 0.03, 0.80, 0.45, 0.30, 1.10),
    "Real Estate": (7.0, 0.30, 0.65, 0.40, 0.04, 1.00, 0.85, 0.22, 0.80),
}

# (Code, Name, Börse, Sektor, Branche, Zielmarktkapitalisierung in Mrd.)
COMPANIES: list[tuple[str, str, str, str, str, float]] = [
    ("NWND", "Northwind Systems Inc", "US", "Technology", "Software—Infrastructure", 610),
    ("CLDV", "Cloudvale Inc", "US", "Technology", "Software—Application", 145),
    ("QBIT", "Quanterra Semiconductor Corp", "US", "Technology", "Semiconductors", 820),
    ("DTSN", "Datasense Analytics Inc", "US", "Technology", "Software—Application", 38),
    ("LMNA", "Lumina Optics Corp", "US", "Technology", "Scientific & Technical Instruments", 21),
    ("HLXT", "Helixtrue Therapeutics Inc", "US", "Healthcare", "Biotechnology", 64),
    ("MDRN", "Meridian Health Group Inc", "US", "Healthcare", "Medical Devices", 132),
    ("PNCL", "Pinnacle Bancorp", "US", "Financial Services", "Banks—Regional", 47),
    ("ATLS", "Atlas Capital Partners Inc", "US", "Financial Services", "Asset Management", 88),
    ("BRKW", "Brookwell Insurance Group", "US", "Financial Services", "Insurance—Property & Casualty", 71),
    ("SLMT", "Summit Retail Co", "US", "Consumer Cyclical", "Specialty Retail", 54),
    ("VLTA", "Voltaro Motors Inc", "US", "Consumer Cyclical", "Auto Manufacturers", 390),
    ("HRVS", "Harvest Table Foods Inc", "US", "Consumer Defensive", "Packaged Foods", 42),
    ("GRNL", "Greenleaf Household Corp", "US", "Consumer Defensive", "Household & Personal Products", 230),
    ("ORCX", "Orcaflux Energy Corp", "US", "Energy", "Oil & Gas Integrated", 310),
    ("SOLW", "Solwind Renewables Inc", "US", "Utilities", "Utilities—Renewable", 27),
    ("IRNF", "Ironforge Industries Inc", "US", "Industrials", "Specialty Industrial Machinery", 96),
    ("SKYP", "Skyport Aerospace Corp", "US", "Industrials", "Aerospace & Defense", 158),
    ("FRTL", "Fortel Logistics Inc", "US", "Industrials", "Integrated Freight & Logistics", 34),
    ("STRM", "Streamline Media Inc", "US", "Communication Services", "Entertainment", 205),
    ("CNXT", "Connexa Networks Inc", "US", "Communication Services", "Telecom Services", 118),
    ("PXLA", "Pixela Games Inc", "US", "Communication Services", "Electronic Gaming & Multimedia", 29),
    ("KRBN", "Karbon Materials Corp", "US", "Basic Materials", "Specialty Chemicals", 36),
    ("ARGN", "Argentum Mining Corp", "US", "Basic Materials", "Gold", 18),
    ("VRDE", "Verde Realty Trust", "US", "Real Estate", "REIT—Industrial", 49),
    ("NRDW", "Nordwerk AG", "XETRA", "Industrials", "Specialty Industrial Machinery", 74),
    ("RHNC", "Rheinchem SE", "XETRA", "Basic Materials", "Chemicals", 41),
    ("ALPV", "Alpenversicherung AG", "XETRA", "Financial Services", "Insurance—Diversified", 112),
    ("HNSB", "Hansebank AG", "XETRA", "Financial Services", "Banks—Diversified", 33),
    ("ELBT", "Elbtal Software SE", "XETRA", "Technology", "Software—Application", 186),
    ("MTRW", "Motorwerke Süd AG", "XETRA", "Consumer Cyclical", "Auto Manufacturers", 58),
    ("BVRP", "Bavaria Pharma AG", "XETRA", "Healthcare", "Drug Manufacturers—General", 67),
    ("SPRK", "Sparkline Energie AG", "XETRA", "Utilities", "Utilities—Diversified", 45),
    ("DNBL", "Donaublick Immobilien SE", "XETRA", "Real Estate", "Real Estate Services", 16),
    ("KLMT", "Klimatec AG", "XETRA", "Industrials", "Building Products & Equipment", 12),
    ("LMRE", "Lumière Luxe SA", "PA", "Consumer Cyclical", "Luxury Goods", 340),
    ("AQTN", "Aquitaine Énergies SA", "PA", "Energy", "Oil & Gas Integrated", 128),
    ("CRVL", "Cervole Aéro SA", "PA", "Industrials", "Aerospace & Defense", 95),
    ("DLTA", "Deltachip NV", "AS", "Technology", "Semiconductor Equipment & Materials", 270),
    ("TLPN", "Tulpen Retail NV", "AS", "Consumer Defensive", "Grocery Stores", 31),
    ("GLTS", "Gletscher Pharma AG", "SW", "Healthcare", "Drug Manufacturers—General", 245),
    ("MTHR", "Matterhorn Foods AG", "SW", "Consumer Defensive", "Packaged Foods", 260),
    ("THMS", "Thameside Bank plc", "LSE", "Financial Services", "Banks—Diversified", 62),
    ("CRWN", "Crownfield Mining plc", "LSE", "Basic Materials", "Other Industrial Metals & Mining", 79),
]

EXCHANGE_INFO: dict[str, tuple[str, str, str]] = {
    # Börse -> (Währung, Land, Handelszeit-Gruppe)
    "US": ("USD", "USA", "us"),
    "XETRA": ("EUR", "Germany", "eu"),
    "PA": ("EUR", "France", "eu"),
    "AS": ("EUR", "Netherlands", "eu"),
    "SW": ("CHF", "Switzerland", "sw"),
    "LSE": ("GBP", "United Kingdom", "lse"),
}

# Handelszeiten in lokaler Börsenzeit (Sommer-/Winterzeit wird über die Zeitzone berücksichtigt)
SESSIONS: dict[str, tuple[str, tuple[int, int], tuple[int, int]]] = {
    "us": ("America/New_York", (9, 30), (16, 0)),
    "eu": ("Europe/Berlin", (9, 0), (17, 30)),
    "lse": ("Europe/London", (8, 0), (16, 30)),
    "sw": ("Europe/Zurich", (9, 0), (17, 30)),
    "asia": ("Asia/Tokyo", (9, 0), (15, 0)),
    "hk": ("Asia/Hong_Kong", (9, 30), (16, 0)),
    "fx": ("UTC", (0, 0), (23, 55)),
}

# Indizes: Startniveau Anfang 2016, jährliche Drift, Handelszeitgruppe
INDEX_PARAMS: dict[str, tuple[float, float, str]] = {
    "GSPC.INDX": (2000, 0.10, "us"),
    "NDX.INDX": (4400, 0.15, "us"),
    "DJI.INDX": (17000, 0.085, "us"),
    "RUT.INDX": (1100, 0.06, "us"),
    "GSPTSE.INDX": (13000, 0.055, "us"),
    "GDAXI.INDX": (10200, 0.07, "eu"),
    "MDAXI.INDX": (20000, 0.03, "eu"),
    "STOXX50E.INDX": (3200, 0.05, "eu"),
    "FCHI.INDX": (4500, 0.055, "eu"),
    "FTSE.INDX": (6100, 0.035, "lse"),
    "SSMI.INDX": (8500, 0.03, "sw"),
    "N225.INDX": (18000, 0.09, "asia"),
    "HSI.INDX": (21000, 0.0, "hk"),
    "AXJO.INDX": (5300, 0.04, "asia"),
}

FX_PARAMS: dict[str, tuple[float, float]] = {
    # Start 2016, Volatilität p. a.
    "EURUSD.FOREX": (1.09, 0.07),
    "GBPUSD.FOREX": (1.47, 0.08),
    "USDJPY.FOREX": (119.0, 0.09),
    "USDCHF.FOREX": (1.00, 0.07),
    "AUDUSD.FOREX": (0.71, 0.10),
    "USDCAD.FOREX": (1.40, 0.07),
    "NZDUSD.FOREX": (0.66, 0.10),
    "EURGBP.FOREX": (0.74, 0.07),
    "EURCHF.FOREX": (1.09, 0.05),
    "EURJPY.FOREX": (130.0, 0.09),
    "USDCNH.FOREX": (6.55, 0.04),
    "BTC-USD.CC": (430.0, 0.55),
}

COMMODITIES: list[tuple[str, str, float, float, float]] = [
    # Ticker, Name, Start 2016, Drift p. a., Volatilität p. a.
    ("GOLD.COMM", "Gold (USD/oz)", 1060.0, 0.10, 0.15),
    ("SILVER.COMM", "Silber (USD/oz)", 14.0, 0.07, 0.27),
    ("WTI.COMM", "WTI-Öl (USD/bbl)", 37.0, 0.05, 0.40),
    ("BRENT.COMM", "Brent-Öl (USD/bbl)", 38.0, 0.05, 0.36),
    ("NATGAS.COMM", "Erdgas (USD/MMBtu)", 2.3, 0.03, 0.42),
    ("COPPER.COMM", "Kupfer (USD/lb)", 2.1, 0.08, 0.22),
    ("WHEAT.COMM", "Weizen (USc/bu)", 470.0, 0.02, 0.28),
    ("PLAT.COMM", "Platin (USD/oz)", 870.0, 0.02, 0.24),
    ("PALL.COMM", "Palladium (USD/oz)", 560.0, 0.06, 0.35),
    ("CORN.COMM", "Mais (USc/bu)", 360.0, 0.02, 0.24),
    ("SOY.COMM", "Sojabohnen (USc/bu)", 870.0, 0.02, 0.20),
    ("COFFEE.COMM", "Kaffee (USc/lb)", 120.0, 0.07, 0.32),
    ("SUGAR.COMM", "Zucker (USc/lb)", 14.5, 0.03, 0.30),
    ("ALU.COMM", "Aluminium (USD/t)", 1500.0, 0.04, 0.20),
]

# Zinskurven: Stützstellen (Datum, Leitzins, langes Ende)
CURVE_KNOTS: dict[str, list[tuple[str, float, float]]] = {
    "US": [("2016-01-01", 0.4, 2.3), ("2018-12-31", 2.4, 2.9), ("2019-12-31", 1.6, 1.9),
           ("2020-04-01", 0.1, 0.9), ("2021-12-31", 0.1, 1.7), ("2022-12-31", 4.3, 3.8),
           ("2023-08-01", 5.3, 4.3), ("2024-09-01", 5.3, 4.0), ("2025-06-30", 4.4, 4.4),
           ("2026-12-31", 3.6, 4.2)],
    "DE": [("2016-01-01", -0.4, 0.5), ("2019-09-01", -0.5, -0.4), ("2021-12-31", -0.5, 0.0),
           ("2022-07-01", -0.3, 1.3), ("2023-09-30", 3.8, 2.7), ("2024-06-01", 3.7, 2.5),
           ("2025-06-30", 2.0, 2.6), ("2026-12-31", 2.0, 2.7)],
    "UK": [("2016-01-01", 0.5, 1.8), ("2019-12-31", 0.75, 0.8), ("2020-04-01", 0.1, 0.4),
           ("2021-12-31", 0.25, 1.0), ("2023-08-31", 5.25, 4.4), ("2024-08-01", 5.0, 4.0),
           ("2025-06-30", 4.25, 4.5), ("2026-12-31", 3.6, 4.4)],
    "FR": [("2016-01-01", -0.4, 0.9), ("2019-09-01", -0.5, -0.2), ("2021-12-31", -0.5, 0.2),
           ("2022-07-01", -0.3, 1.9), ("2023-09-30", 3.8, 3.3), ("2024-06-01", 3.7, 3.1),
           ("2025-06-30", 2.0, 3.3), ("2026-12-31", 2.0, 3.4)],
    "IT": [("2016-01-01", -0.3, 1.6), ("2018-06-01", -0.3, 2.9), ("2019-09-01", -0.4, 0.9),
           ("2021-12-31", -0.4, 1.2), ("2022-10-01", 0.8, 4.6), ("2023-09-30", 3.8, 4.8),
           ("2024-06-01", 3.7, 3.9), ("2025-06-30", 2.1, 3.5), ("2026-12-31", 2.1, 3.6)],
    "JP": [("2016-01-01", 0.0, 0.25), ("2016-03-01", -0.1, -0.05), ("2021-12-31", -0.1, 0.07),
           ("2023-12-31", -0.1, 0.6), ("2024-03-31", 0.05, 0.75), ("2025-01-31", 0.5, 1.2),
           ("2026-12-31", 0.75, 1.7)],
}

FIRST_NAMES = ["Anna", "Jonas", "Clara", "Mateo", "Sofia", "Lukas", "Emma", "Noah", "Lea", "Elias",
               "Mia", "Ben", "Hannah", "Paul", "Ella", "David", "Lina", "Tom", "Maya", "Felix"]
LAST_NAMES = ["Berger", "Lindqvist", "Moreau", "Okafor", "Hartmann", "Silva", "Novak", "Keller",
              "Rossi", "Tanaka", "Weber", "Brennan", "Fischer", "Dubois", "Kowalski", "Jansen"]
OFFICER_TITLES = ["Chief Executive Officer", "Chief Financial Officer", "Chief Operating Officer",
                  "Chief Technology Officer", "General Counsel"]

# Übernahmeziele werden aus Vor- und Nachsilbe zusammengesetzt (je Unternehmen und Monat verschieden)
TARGET_PREFIX = ["Bluecrest", "Ostwind", "Corvalis", "Paxton", "Meridia", "Silverline", "Arcadia", "Novaterm",
                 "Brightway", "Kestrel", "Halden", "Vireo", "Solara", "Tidewater", "Lindholm", "Quarzwerk"]
TARGET_SUFFIX = ["Labs", "Digital", "Data", "Tools", "Bio", "Parts", "Sensors", "Services", "Systems",
                 "Robotics", "Analytics", "Materials"]

# Makro-Grundniveaus je Land: Wachstum, Inflation, Arbeitslosigkeit, Schulden 2000 -> 2025,
# BIP/Kopf 2000 -> 2025 (USD), BIP 2025 (Mrd. USD), Realzins
MACRO_BASE: dict[str, tuple[float, float, float, tuple[float, float], tuple[float, float], float, float]] = {
    "USA": (2.2, 2.4, 5.4, (55, 121), (36000, 86000), 29000, 1.8),
    "DEU": (1.1, 1.7, 7.0, (59, 63), (23500, 55000), 4700, 0.5),
    "FRA": (1.2, 1.6, 8.8, (58, 113), (22400, 46000), 3200, 0.8),
    "GBR": (1.6, 2.2, 5.6, (37, 101), (28000, 52000), 3600, 0.7),
    "ITA": (0.5, 1.8, 9.5, (105, 137), (20000, 39000), 2300, 1.5),
    "ESP": (1.7, 2.1, 15.0, (58, 102), (14700, 34000), 1800, 1.0),
    "JPN": (0.7, 0.3, 3.8, (135, 250), (39000, 33000), 4100, 1.1),
    "CHN": (7.8, 2.0, 4.3, (23, 88), (960, 13500), 18700, 2.5),
    "IND": (6.4, 5.6, 7.5, (73, 82), (440, 2700), 3900, 3.0),
    "BRA": (2.0, 6.0, 10.5, (66, 87), (3700, 10300), 2200, 5.5),
    "CAN": (2.0, 2.1, 7.0, (82, 107), (24200, 53500), 2300, 1.2),
    "AUS": (2.7, 2.6, 5.6, (19, 50), (21700, 65000), 1800, 1.4),
}


# Deutsche Branchennamen für die generierten Meldungen
INDUSTRY_DE: dict[str, str] = {
    "Aerospace & Defense": "Luft- und Raumfahrt, Verteidigung",
    "Asset Management": "Vermögensverwaltung",
    "Auto Manufacturers": "Automobilhersteller",
    "Auto Parts": "Autozulieferer",
    "Banks—Diversified": "Universalbanken",
    "Banks—Regional": "Regionalbanken",
    "Biotechnology": "Biotechnologie",
    "Building Products & Equipment": "Baustoffe und -ausrüstung",
    "Chemicals": "Chemie",
    "Communication Equipment": "Kommunikationstechnik",
    "Consumer Electronics": "Unterhaltungselektronik",
    "Credit Services": "Kreditdienstleistungen",
    "Diagnostics & Research": "Diagnostik und Forschung",
    "Drug Manufacturers—General": "Pharma",
    "Electronic Gaming & Multimedia": "Spiele und Multimedia",
    "Entertainment": "Unterhaltung",
    "Gold": "Gold",
    "Grocery Stores": "Lebensmittelhandel",
    "Household & Personal Products": "Haushalts- und Körperpflege",
    "Information Technology Services": "IT-Dienstleistungen",
    "Insurance—Diversified": "Versicherungen (diversifiziert)",
    "Insurance—Property & Casualty": "Sachversicherungen",
    "Integrated Freight & Logistics": "Logistik",
    "Internet Content & Information": "Internetinhalte",
    "Internet Retail": "Onlinehandel",
    "Luxury Goods": "Luxusgüter",
    "Medical Devices": "Medizintechnik",
    "Oil & Gas Integrated": "Öl und Gas (integriert)",
    "Other Industrial Metals & Mining": "Industriemetalle und Bergbau",
    "Packaged Foods": "Nahrungsmittel",
    "REIT—Industrial": "REIT Gewerbeimmobilien",
    "Real Estate Services": "Immobiliendienstleistungen",
    "Scientific & Technical Instruments": "Mess- und Prüftechnik",
    "Semiconductor Equipment & Materials": "Halbleiterausrüstung",
    "Semiconductors": "Halbleiter",
    "Software—Application": "Anwendungssoftware",
    "Software—Infrastructure": "Infrastruktursoftware",
    "Specialty Chemicals": "Spezialchemie",
    "Specialty Industrial Machinery": "Maschinenbau",
    "Specialty Retail": "Fachhandel",
    "Telecom Services": "Telekommunikation",
    "Utilities—Diversified": "Versorger (diversifiziert)",
    "Utilities—Regulated Electric": "Stromversorger",
    "Utilities—Renewable": "Erneuerbare Energien",
}

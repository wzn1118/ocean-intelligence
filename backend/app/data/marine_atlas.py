"""Offline marine place atlas used by point-level context and the knowledge layer.

The live Marine Regions gazetteer is intentionally kept as an enrichment source,
but it is not a reliable first paint dependency.  This module contains a compact,
versioned catalogue of named oceans, seas, gulfs, bays, straits, channels and
fjords.  Every row has a Chinese display name, an English canonical name, a
feature type and a parent ocean.  The spatial subset has an approximate centre
and search radius so a clicked point can be named while the network lookup is
still pending.  The full catalogue remains available for offline encyclopedia
search even when a feature does not have a local geometry yet.
"""

from __future__ import annotations

from math import asin, cos, radians, sin, sqrt
from typing import Any

from app.data.chinese_text import normalize_political_language, normalize_text_fields


ATLAS_VERSION = "2026.08"
ATLAS_SOURCE_URL = "https://www.marineregions.org/"


_KIND_ZH = {
    "ocean": "大洋",
    "sea": "海",
    "gulf": "海湾",
    "bay": "海湾",
    "strait": "海峡",
    "channel": "水道",
    "sound": "海峡/海湾",
    "fjord": "峡湾",
    "passage": "水道",
}

_PARENT_ZH = {
    "Pacific Ocean": "太平洋",
    "Atlantic Ocean": "大西洋",
    "Indian Ocean": "印度洋",
    "Arctic Ocean": "北冰洋",
    "Southern Ocean": "南大洋",
    "Mediterranean Sea": "地中海",
    "Baltic Sea": "波罗的海",
    "Black Sea": "黑海",
    "Red Sea": "红海",
    "South China Sea": "南海",
    "Coral Sea": "珊瑚海",
    "Caribbean Sea": "加勒比海",
}

_OCEAN_NAMES_EN = {
    "Pacific Ocean",
    "Atlantic Ocean",
    "Indian Ocean",
    "Arctic Ocean",
    "Southern Ocean",
}


# The first block carries coordinates for the most frequently clicked features.
# Remaining catalogue rows are still exact named records and are used for the
# encyclopedia/search layer; they can be enriched with geometries later without
# changing the public schema.
_SPATIAL: dict[str, tuple[float, float, float]] = {
    "Pacific Ocean": (170.0, 0.0, 1900.0),
    "Atlantic Ocean": (-30.0, 5.0, 1800.0),
    "Indian Ocean": (75.0, -15.0, 1700.0),
    "Arctic Ocean": (0.0, 82.0, 1100.0),
    "Southern Ocean": (0.0, -65.0, 1200.0),
    "South China Sea": (114.0, 13.0, 1100.0),
    "East China Sea": (125.0, 27.0, 500.0),
    "Yellow Sea": (123.0, 35.0, 320.0),
    "Bohai Sea": (119.5, 38.5, 220.0),
    "Sea of Japan": (137.0, 40.0, 650.0),
    "Sea of Okhotsk": (150.0, 55.0, 650.0),
    "Bering Sea": (-170.0, 58.0, 800.0),
    "Philippine Sea": (145.0, 20.0, 900.0),
    "Coral Sea": (155.0, -18.0, 850.0),
    "Tasman Sea": (160.0, -38.0, 650.0),
    "Arafura Sea": (136.0, -10.0, 360.0),
    "Timor Sea": (127.0, -11.0, 420.0),
    "Sulu Sea": (121.0, 9.0, 300.0),
    "Celebes Sea": (124.0, 3.0, 380.0),
    "Java Sea": (110.0, -5.0, 260.0),
    "Banda Sea": (127.0, -5.0, 420.0),
    "Flores Sea": (121.0, -7.5, 260.0),
    "Savu Sea": (123.0, -10.5, 260.0),
    "Seram Sea": (130.0, -2.5, 260.0),
    "Halmahera Sea": (128.0, 1.0, 260.0),
    "Andaman Sea": (94.0, 10.0, 450.0),
    "Bay of Bengal": (88.0, 14.0, 850.0),
    "Arabian Sea": (64.0, 15.0, 750.0),
    "Red Sea": (39.0, 20.0, 430.0),
    "Persian Gulf": (51.0, 27.0, 260.0),
    "Gulf of Oman": (59.0, 25.5, 250.0),
    "Gulf of Aden": (47.5, 13.0, 300.0),
    "Mozambique Channel": (42.0, -17.0, 520.0),
    "Mediterranean Sea": (18.0, 35.0, 850.0),
    "Black Sea": (34.0, 43.0, 420.0),
    "Sea of Azov": (37.0, 46.0, 160.0),
    "Baltic Sea": (20.0, 58.0, 450.0),
    "North Sea": (3.0, 56.0, 420.0),
    "Norwegian Sea": (2.0, 67.0, 650.0),
    "Barents Sea": (40.0, 73.0, 500.0),
    "Greenland Sea": (-5.0, 75.0, 500.0),
    "Labrador Sea": (-55.0, 57.0, 550.0),
    "Caribbean Sea": (-75.0, 15.0, 650.0),
    "Gulf of Mexico": (-90.0, 24.0, 650.0),
    "Gulf of Alaska": (-145.0, 55.0, 500.0),
    "Gulf of California": (-112.0, 27.0, 420.0),
    "Hudson Bay": (-85.0, 60.0, 480.0),
    "Baffin Bay": (-68.0, 73.0, 460.0),
    "Gulf of Guinea": (2.0, 2.0, 550.0),
    "Weddell Sea": (-40.0, -74.0, 600.0),
    "Ross Sea": (175.0, -72.0, 520.0),
    "Amundsen Sea": (-110.0, -72.0, 380.0),
    "Bellingshausen Sea": (-80.0, -70.0, 420.0),
    "Scotia Sea": (-45.0, -57.0, 430.0),
    "Taiwan Strait": (119.5, 24.0, 180.0),
    "Luzon Strait": (122.0, 19.0, 150.0),
    "Malacca Strait": (101.5, 3.0, 190.0),
    "Singapore Strait": (103.8, 1.2, 65.0),
    "Sunda Strait": (105.8, -5.9, 100.0),
    "Lombok Strait": (116.0, -8.5, 80.0),
    "Makassar Strait": (117.5, -1.0, 260.0),
    "Karimata Strait": (109.5, -1.5, 130.0),
    "Bangka Strait": (105.8, -2.0, 70.0),
    "Torres Strait": (142.0, -10.5, 180.0),
    "Bass Strait": (147.0, -39.5, 180.0),
    "Cook Strait": (174.3, -41.2, 100.0),
    "Tsushima Strait": (130.5, 34.0, 110.0),
    "Tsugaru Strait": (140.5, 41.5, 75.0),
    "La Perouse Strait": (142.0, 45.5, 90.0),
    "Korea Strait": (129.5, 34.5, 120.0),
    "Bering Strait": (-169.0, 65.8, 75.0),
    "Davis Strait": (-61.0, 66.0, 260.0),
    "Denmark Strait": (-29.0, 66.0, 160.0),
    "Fram Strait": (-5.0, 79.0, 160.0),
    "Strait of Gibraltar": (-5.6, 35.9, 75.0),
    "Bosporus": (29.1, 41.1, 35.0),
    "Dardanelles": (26.3, 40.2, 45.0),
    "Strait of Hormuz": (56.3, 26.6, 90.0),
    "Bab-el-Mandeb": (43.3, 12.6, 85.0),
    "Palk Strait": (79.6, 9.7, 90.0),
    "Drake Passage": (-62.0, -58.0, 360.0),
    "Strait of Magellan": (-72.0, -53.5, 100.0),
    "Le Maire Strait": (-66.7, -54.7, 50.0),
    "Foveaux Strait": (168.0, -46.7, 75.0),
    "Vitiaz Strait": (148.0, -5.7, 100.0),
    "St George's Channel": (-5.5, 52.0, 130.0),
    "English Channel": (-2.5, 50.0, 180.0),
    "Strait of Dover": (1.4, 51.0, 55.0),
    "Strait of Otranto": (18.0, 40.2, 70.0),
    "Strait of Messina": (15.6, 38.2, 35.0),
    "Strait of Bonifacio": (9.0, 41.3, 55.0),
    "Kerch Strait": (36.5, 45.3, 55.0),
    "Gulf of Thailand": (102.0, 10.0, 330.0),
    "Gulf of Tonkin": (107.0, 19.0, 240.0),
    "Gulf of Carpentaria": (138.0, -15.0, 350.0),
    "Gulf of Papua": (145.0, -9.0, 240.0),
    "Great Australian Bight": (130.0, -34.0, 450.0),
    "Bay of Biscay": (-5.0, 45.0, 370.0),
    "Bay of Fundy": (-65.5, 45.0, 95.0),
    "Bay of Campeche": (-93.0, 21.5, 230.0),
    "Bay of Bengal": (88.0, 14.0, 850.0),
}


# Each line is Chinese name | canonical English name.  The lists intentionally
# include marginal seas and named passages used by nautical charts, not only the
# large ocean basins.  They are kept as source data so adding a new record does
# not require changing matching logic.
_GROUPS: tuple[tuple[str, str, str], ...] = (
    ("ocean", "Pacific Ocean", """
太平洋|Pacific Ocean
大西洋|Atlantic Ocean
印度洋|Indian Ocean
北冰洋|Arctic Ocean
南大洋|Southern Ocean
"""),
    ("sea", "Pacific Ocean", """
北太平洋|North Pacific Ocean
南太平洋|South Pacific Ocean
西太平洋|Western Pacific Ocean
东太平洋|Eastern Pacific Ocean
中太平洋|Central Pacific Ocean
西北太平洋|Northwest Pacific Ocean
西南太平洋|Southwest Pacific Ocean
东北太平洋|Northeast Pacific Ocean
东南太平洋|Southeast Pacific Ocean
白令海|Bering Sea
鄂霍次克海|Sea of Okhotsk
日本海|Sea of Japan
东海|East China Sea
黄海|Yellow Sea
渤海|Bohai Sea
南海|South China Sea
菲律宾海|Philippine Sea
珊瑚海|Coral Sea
塔斯曼海|Tasman Sea
阿拉弗拉海|Arafura Sea
帝汶海|Timor Sea
所罗门海|Solomon Sea
俾斯麦海|Bismarck Sea
苏禄海|Sulu Sea
苏拉威西海|Celebes Sea
爪哇海|Java Sea
班达海|Banda Sea
弗洛勒斯海|Flores Sea
萨武海|Savu Sea
塞兰海|Seram Sea
哈马黑拉海|Halmahera Sea
巴厘海|Bali Sea
阿拉斯加湾|Gulf of Alaska
加利福尼亚湾|Gulf of California
科特斯海|Sea of Cortez
阿拉斯加湾东部|Eastern Gulf of Alaska
科曼多尔海|Commander Sea
鄂霍次克海南部|Southern Sea of Okhotsk
菲律宾海西部|Western Philippine Sea
菲律宾海东部|Eastern Philippine Sea
南海北部|Northern South China Sea
南海南部|Southern South China Sea
东海北部|Northern East China Sea
东海南部|Southern East China Sea
日本海西部|Western Sea of Japan
日本海东部|Eastern Sea of Japan
珊瑚海南部|Southern Coral Sea
塔斯曼海北部|Northern Tasman Sea
塔斯曼海南部|Southern Tasman Sea
新喀里多尼亚海|New Caledonia Sea
斐济海|Fiji Sea
科罗海|Koro Sea
所罗门海南部|Southern Solomon Sea
俾斯麦海南部|Southern Bismarck Sea
阿拉弗拉海西部|Western Arafura Sea
帝汶海北部|Northern Timor Sea
帝汶海南部|Southern Timor Sea
爪哇海东部|Eastern Java Sea
班达海东部|Eastern Banda Sea
班达海南部|Southern Banda Sea
苏禄海西部|Western Sulu Sea
苏禄海东部|Eastern Sulu Sea
苏拉威西海北部|Northern Celebes Sea
苏拉威西海南部|Southern Celebes Sea
望加锡海峡外海|Makassar Offshore Sea
龙目海|Lombok Sea
萨武海西部|Western Savu Sea
弗洛勒斯海东部|Eastern Flores Sea
莫卢卡海|Molucca Sea
马鲁古海|Molucca Sea
阿拉弗拉海东部|Eastern Arafura Sea
珊瑚海北部|Northern Coral Sea
珊瑚海东部|Eastern Coral Sea
澳大利亚东部海域|East Australian Sea
新西兰北部海域|North New Zealand Sea
新西兰南部海域|South New Zealand Sea
南太平洋副热带海域|South Pacific Subtropical Sea
北太平洋副热带海域|North Pacific Subtropical Sea
北太平洋副极地海域|North Pacific Subpolar Sea
南太平洋副极地海域|South Pacific Subpolar Sea
秘鲁海域|Peru Sea
智利海域|Chile Sea
巴拿马湾外海|Panama Offshore Sea
中美洲太平洋海域|Central American Pacific Sea
墨西哥西岸海域|Mexican Pacific Sea
加拿大西岸海域|Canadian Pacific Sea
美国西岸海域|US Pacific Coast Sea
阿留申海域|Aleutian Sea
阿留申群岛南部海域|Aleutian South Sea
阿留申群岛北部海域|Aleutian North Sea
白令海南部|Southern Bering Sea
白令海北部|Northern Bering Sea
白令海东部|Eastern Bering Sea
白令海西部|Western Bering Sea
"""),
    ("sea", "Atlantic Ocean", """
大西洋|Atlantic Ocean
北大西洋|North Atlantic Ocean
南大西洋|South Atlantic Ocean
北大西洋副热带海域|North Atlantic Subtropical Sea
南大西洋副热带海域|South Atlantic Subtropical Sea
东北大西洋|Northeast Atlantic Ocean
东南大西洋|Southeast Atlantic Ocean
西北大西洋|Northwest Atlantic Ocean
西南大西洋|Southwest Atlantic Ocean
加勒比海|Caribbean Sea
马尾藻海|Sargasso Sea
百慕大海域|Bermuda Sea
拉布拉多海|Labrador Sea
纽芬兰海|Newfoundland Sea
萨加索海北部|Northern Sargasso Sea
萨加索海南部|Southern Sargasso Sea
佛罗里达海峡外海|Florida Offshore Sea
安的列斯海|Antilles Sea
小安的列斯海|Lesser Antilles Sea
大安的列斯海|Greater Antilles Sea
墨西哥湾|Gulf of Mexico
美国湾|Gulf of America
洪都拉斯湾|Gulf of Honduras
尤卡坦海峡海域|Yucatan Sea
坎佩切湾|Bay of Campeche
委内瑞拉湾|Gulf of Venezuela
达连湾|Gulf of Darien
巴拿马湾|Gulf of Panama
巴拿马湾北部|Northern Gulf of Panama
尼科亚湾|Gulf of Nicoya
丰塞卡湾|Gulf of Fonseca
瓜亚基尔湾|Gulf of Guayaquil
圣马蒂亚斯湾|Gulf of San Matias
圣豪尔赫湾|Gulf of San Jorge
佩尼亚斯湾|Gulf of Penas
新湾|Golfo Nuevo
圣文森特湾|Gulf of Saint Vincent
大澳大利亚湾|Great Australian Bight
几内亚湾|Gulf of Guinea
比夫拉湾|Bight of Biafra
贝宁湾|Bight of Benin
塞拉利昂湾|Sierra Leone Bay
利比里亚湾|Liberia Bay
阿尔戈湾|Algoa Bay
桌湾|Table Bay
福尔斯湾|False Bay
沃尔维斯湾|Walvis Bay
吕德里茨湾|Luderitz Bay
索法拉湾|Sofala Bay
德拉戈阿湾|Delagoa Bay
马普托湾|Maputo Bay
圣劳伦斯湾|Gulf of Saint Lawrence
缅因湾|Gulf of Maine
芬迪湾|Bay of Fundy
哈德逊湾|Hudson Bay
詹姆斯湾|James Bay
昂加瓦湾|Ungava Bay
巴芬湾|Baffin Bay
切萨皮克湾|Chesapeake Bay
特拉华湾|Delaware Bay
科德角湾|Cape Cod Bay
长岛海峡|Long Island Sound
纽约湾|New York Bay
北卡罗来纳湾|North Carolina Bay
乔治亚湾|Georgia Bay
圣玛格丽特湾|St Margarets Bay
布雷顿角湾|Cape Breton Bay
阿根廷海|Argentine Sea
巴西海|Brazil Sea
乌拉圭海|Uruguay Sea
巴塔哥尼亚海|Patagonian Sea
福克兰海|Falkland Sea
斯科舍海|Scotia Sea
格陵兰海|Greenland Sea
冰岛海|Iceland Sea
挪威海|Norwegian Sea
凯尔特海|Celtic Sea
爱尔兰海|Irish Sea
北海|North Sea
英吉利海峡海域|English Channel Sea
比斯开湾|Bay of Biscay
阿尔沃兰海|Alboran Sea
"""),
    ("sea", "Indian Ocean", """
印度洋|Indian Ocean
北印度洋|North Indian Ocean
南印度洋|South Indian Ocean
西印度洋|Western Indian Ocean
东印度洋|Eastern Indian Ocean
阿拉伯海|Arabian Sea
孟加拉湾|Bay of Bengal
安达曼海|Andaman Sea
拉克代夫海|Laccadive Sea
马尔代夫海|Maldives Sea
索马里海|Somali Sea
红海|Red Sea
亚丁湾|Gulf of Aden
阿曼湾|Gulf of Oman
波斯湾|Persian Gulf
阿曼海|Oman Sea
曼纳湾|Gulf of Mannar
马尔塔班湾|Gulf of Martaban
卡奇湾|Gulf of Kutch
坎贝湾|Gulf of Khambhat
塔朱拉湾|Gulf of Tadjoura
苏伊士湾|Gulf of Suez
亚喀巴湾|Gulf of Aqaba
莫桑比克海峡|Mozambique Channel
桑给巴尔海峡海域|Zanzibar Channel Sea
马达加斯加海域|Madagascar Sea
莫桑比克海域|Mozambique Sea
塞舌尔海域|Seychelles Sea
马斯克林海域|Mascarene Sea
科摩罗海域|Comoros Sea
索科特拉海域|Socotra Sea
阿曼外海|Offshore Oman Sea
巴基斯坦外海|Pakistan Offshore Sea
印度西岸海域|West India Sea
印度东岸海域|East India Sea
斯里兰卡南部海域|South Sri Lanka Sea
斯里兰卡东部海域|East Sri Lanka Sea
孟加拉湾北部|Northern Bay of Bengal
孟加拉湾南部|Southern Bay of Bengal
孟加拉湾西部|Western Bay of Bengal
孟加拉湾东部|Eastern Bay of Bengal
安达曼海北部|Northern Andaman Sea
安达曼海南部|Southern Andaman Sea
阿拉伯海西部|Western Arabian Sea
阿拉伯海东部|Eastern Arabian Sea
阿拉伯海北部|Northern Arabian Sea
阿拉伯海南部|Southern Arabian Sea
红海北部|Northern Red Sea
红海南部|Southern Red Sea
红海中部|Central Red Sea
波斯湾北部|Northern Persian Gulf
波斯湾南部|Southern Persian Gulf
阿曼湾北部|Northern Gulf of Oman
亚丁湾北部|Northern Gulf of Aden
亚丁湾南部|Southern Gulf of Aden
索马里盆地海域|Somali Basin Sea
马达加斯加盆地海域|Madagascar Basin Sea
西澳大利亚海域|West Australian Sea
东澳大利亚海域|East Indian Australian Sea
大澳大利亚湾|Great Australian Bight
卡奔塔利亚湾|Gulf of Carpentaria
"""),
    ("sea", "Arctic Ocean", """
北冰洋|Arctic Ocean
北极海域|Polar Arctic Sea
巴伦支海|Barents Sea
喀拉海|Kara Sea
拉普捷夫海|Laptev Sea
东西伯利亚海|East Siberian Sea
楚科奇海|Chukchi Sea
波弗特海|Beaufort Sea
格陵兰海|Greenland Sea
林肯海|Lincoln Sea
王妃维多利亚海|Queen Victoria Sea
旺德尔海|Wandel Sea
白海|White Sea
伯朝拉海|Pechora Sea
挪威海北部|Northern Norwegian Sea
冰岛海北部|Northern Iceland Sea
弗拉姆海峡海域|Fram Sea
丹麦海峡海域|Denmark Strait Sea
戴维斯海峡海域|Davis Strait Sea
巴芬湾北部|Northern Baffin Bay
哈德逊湾北部|Northern Hudson Bay
福克斯湾|Foxe Basin Sea
詹姆斯湾北部|Northern James Bay
阿蒙森湾|Amundsen Gulf
麦克卢尔海峡海域|McClure Strait Sea
维多利亚海峡海域|Victoria Strait Sea
巴罗海峡海域|Barrow Strait Sea
兰开斯特海峡海域|Lancaster Sound Sea
纳雷斯海峡海域|Nares Strait Sea
史密斯海峡海域|Smith Sound Sea
皮里海峡海域|Peary Channel Sea
尤里卡海峡海域|Eureka Sound Sea
乔治亚海峡北极段|Arctic Georgia Strait
卡拉海北部|Northern Kara Sea
巴伦支海东部|Eastern Barents Sea
巴伦支海西部|Western Barents Sea
拉普捷夫海东部|Eastern Laptev Sea
楚科奇海西部|Western Chukchi Sea
波弗特海东部|Eastern Beaufort Sea
波弗特海西部|Western Beaufort Sea
东西伯利亚海西部|Western East Siberian Sea
东西伯利亚海东部|Eastern East Siberian Sea
北极群岛海域|Canadian Arctic Archipelago Sea
斯瓦尔巴海域|Svalbard Sea
弗朗茨约瑟夫地群岛海域|Franz Josef Land Sea
新地岛海域|Novaya Zemlya Sea
塞韦尔纳亚泽姆利亚海域|Severnaya Zemlya Sea
新西伯利亚群岛海域|New Siberian Islands Sea
"""),
    ("sea", "Mediterranean Sea", """
地中海|Mediterranean Sea
阿尔沃兰海|Alboran Sea
巴利阿里海|Balearic Sea
利古里亚海|Ligurian Sea
第勒尼安海|Tyrrhenian Sea
亚得里亚海|Adriatic Sea
爱奥尼亚海|Ionian Sea
爱琴海|Aegean Sea
黎凡特海|Levantine Sea
利比亚海|Libyan Sea
克里特海|Cretan Sea
米尔托翁海|Myrtoan Sea
色雷斯海|Thracian Sea
马尔马拉海|Sea of Marmara
黑海|Black Sea
亚速海|Sea of Azov
大理石海|Marmara Sea
巴伦西亚湾|Gulf of Valencia
里昂湾|Gulf of Lion
卡迪斯湾|Gulf of Cadiz
塔兰托湾|Gulf of Taranto
加贝斯湾|Gulf of Gabes
锡德拉湾|Gulf of Sidra
突尼斯湾|Gulf of Tunis
安塔利亚湾|Gulf of Antalya
科林斯湾|Gulf of Corinth
帕特雷湾|Gulf of Patras
阿尔塔湾|Ambracian Gulf
萨罗尼科斯湾|Saronic Gulf
塞尔迈湾|Thermaic Gulf
帕加塞蒂克湾|Pagasetic Gulf
萨罗斯湾|Gulf of Saros
伊斯肯德伦湾|Gulf of Iskenderun
罗萨斯湾|Bay of Roses
狮子湾北部|Northern Gulf of Lion
地中海西部|Western Mediterranean Sea
地中海东部|Eastern Mediterranean Sea
地中海中部|Central Mediterranean Sea
爱琴海北部|Northern Aegean Sea
爱琴海南部|Southern Aegean Sea
亚得里亚海北部|Northern Adriatic Sea
亚得里亚海南部|Southern Adriatic Sea
爱奥尼亚海北部|Northern Ionian Sea
爱奥尼亚海南部|Southern Ionian Sea
第勒尼安海北部|Northern Tyrrhenian Sea
第勒尼安海南部|Southern Tyrrhenian Sea
利古里亚海西部|Western Ligurian Sea
利古里亚海东部|Eastern Ligurian Sea
巴利阿里海西部|Western Balearic Sea
巴利阿里海东部|Eastern Balearic Sea
黎凡特海北部|Northern Levantine Sea
黎凡特海南部|Southern Levantine Sea
马尔马拉海东部|Eastern Sea of Marmara
马尔马拉海西部|Western Sea of Marmara
黑海西部|Western Black Sea
黑海东部|Eastern Black Sea
黑海南部|Southern Black Sea
黑海北部|Northern Black Sea
亚速海东部|Eastern Sea of Azov
亚速海西部|Western Sea of Azov
"""),
    ("sea", "Baltic Sea", """
波罗的海|Baltic Sea
波的尼亚湾|Gulf of Bothnia
芬兰湾|Gulf of Finland
里加湾|Gulf of Riga
但泽湾|Gulf of Gdansk
波美拉尼亚湾|Pomeranian Bay
梅克伦堡湾|Mecklenburg Bay
吕贝克湾|Bay of Lubeck
基尔湾|Kiel Bay
阿伦达尔湾|Arendal Bay
卡特加特海|Kattegat
斯卡格拉克海|Skagerrak
厄勒海峡海域|Oresund Sea
波罗的海西部|Western Baltic Sea
波罗的海东部|Eastern Baltic Sea
波罗的海南部|Southern Baltic Sea
波罗的海北部|Northern Baltic Sea
阿尔泰群岛海域|Aland Sea
萨列马岛海域|Saaremaa Sea
哥得兰海域|Gotland Sea
厄兰海域|Oland Sea
波罗的海中央盆地|Baltic Proper
博恩霍尔姆海域|Bornholm Sea
格但斯克湾东部|Eastern Gulf of Gdansk
芬兰湾东部|Eastern Gulf of Finland
芬兰湾西部|Western Gulf of Finland
里加湾北部|Northern Gulf of Riga
里加湾南部|Southern Gulf of Riga
波的尼亚湾北部|Northern Bothnian Bay
波的尼亚湾南部|Southern Bothnian Bay
波的尼亚海|Bothnian Sea
波的尼亚湾外海|Bothnian Offshore Sea
"""),
    ("strait", "Pacific Ocean", """
中国台湾海峡|Taiwan Strait
吕宋海峡|Luzon Strait
巴士海峡|Bashi Channel
巴拉巴克海峡|Balabac Strait
民都洛海峡|Mindoro Strait
佛得角海峡|Verde Island Passage
圣贝纳迪诺海峡|San Bernardino Strait
苏里高海峡|Surigao Strait
锡布图海峡|Sibutu Passage
巴西兰海峡|Basilan Strait
马六甲海峡|Malacca Strait
新加坡海峡|Singapore Strait
巽他海峡|Sunda Strait
龙目海峡|Lombok Strait
望加锡海峡|Makassar Strait
卡里马塔海峡|Karimata Strait
邦加海峡|Bangka Strait
加斯帕海峡|Gaspar Strait
巴厘海峡|Bali Strait
巴东海峡|Badung Strait
阿拉斯海峡|Alas Strait
萨佩海峡|Sape Strait
翁拜海峡|Ombai Strait
韦塔海峡|Wetar Strait
阿洛海峡|Alor Strait
帝汶海峡|Timor Strait
托雷斯海峡|Torres Strait
丹皮尔海峡|Dampier Strait
维蒂亚兹海峡|Vitiaz Strait
布干维尔海峡|Bougainville Strait
圣乔治海峡|St George's Channel
约克海峡|York Sound
雅朋海峡|Yapen Strait
塞莱海峡|Sele Strait
萨格温海峡|Sagewin Strait
莫鲁凯海峡|Morotai Strait
奥比海峡|Obi Strait
利法马托拉海峡|Lifamatola Strait
马鲁古海峡|Molucca Strait
班达海峡|Banda Strait
弗洛勒斯海峡|Flores Strait
萨武海峡|Savu Strait
巴东外海峡|Badung Passage
库邦海峡|Kupang Strait
松巴海峡|Sumba Strait
松巴哇海峡|Sumbawa Strait
松巴岛海峡|Sumba Island Strait
巴布亚湾口海峡|Papua Gulf Passage
库克海峡|Cook Strait
福沃海峡|Foveaux Strait
巴斯海峡|Bass Strait
班克斯海峡|Banks Strait
法国通道|French Pass
托里海峡|Tory Channel
库克群岛海峡|Cook Islands Passage
新喀里多尼亚海峡|New Caledonia Passage
瓦努阿图海峡|Vanuatu Passage
所罗门海峡|Solomon Passage
圣伊莎贝尔海峡|Santa Isabel Channel
新不列颠海峡|New Britain Strait
玛格达拉海峡|Magdalena Channel
马勒多纳多海峡|Maldonado Strait
奇洛埃海峡|Chacao Channel
莫拉莱达海峡|Moraleda Channel
乔诺斯海峡|Chonos Archipelago Channels
梅西耶海峡|Messier Channel
纳尔逊海峡|Nelson Strait
麦哲伦海峡|Strait of Magellan
德雷克海峡|Drake Passage
勒梅尔海峡|Le Maire Strait
比格尔海峡|Beagle Channel
阿努科塔海峡|Anucota Channel
智利内海通道|Chilean Inland Sea Passage
胡安·德富卡海峡|Strait of Juan de Fuca
乔治亚海峡|Strait of Georgia
赫卡特海峡|Hecate Strait
夏洛特皇后海峡|Queen Charlotte Strait
约翰斯通海峡|Johnstone Strait
海达瓜伊海峡|Haida Gwaii Passage
圣劳伦斯水道|Saint Lawrence Seaway
"""),
    ("strait", "Atlantic Ocean", """
直布罗陀海峡|Strait of Gibraltar
博斯普鲁斯海峡|Bosporus
达达尼尔海峡|Dardanelles
奥特朗托海峡|Strait of Otranto
墨西拿海峡|Strait of Messina
博尼法乔海峡|Strait of Bonifacio
刻赤海峡|Kerch Strait
多佛海峡|Strait of Dover
英吉利海峡|English Channel
北海峡|North Channel
圣乔治海峡|St George's Channel
布里斯托尔海峡|Bristol Channel
拉芒什海峡|La Manche
卡莱海峡|Calais Strait
莫纳海峡|Mona Passage
莫纳海峡东段|Eastern Mona Passage
向风海峡|Windward Passage
海地海峡|Haiti Passage
佛罗里达海峡|Florida Strait
尤卡坦海峡|Yucatan Channel
安的列斯海峡|Antilles Passage
阿内加达海峡|Anegada Passage
多米尼加海峡|Dominica Passage
圣卢西亚海峡|Saint Lucia Channel
圣文森特海峡|Saint Vincent Passage
马提尼克海峡|Martinique Channel
圣巴泰勒米海峡|Saint Barthelemy Passage
巴哈马海峡|Bahama Channel
卡纳维拉尔海峡|Canaveral Channel
巴哈马大滩海峡|Great Bahama Bank Passage
戴维斯海峡|Davis Strait
丹麦海峡|Denmark Strait
弗拉姆海峡|Fram Strait
哈德逊海峡|Hudson Strait
贝尔岛海峡|Strait of Belle Isle
卡伯特海峡|Cabot Strait
诺森伯兰海峡|Northumberland Strait
圣乔治湾海峡|St George Bay Passage
马格达伦海峡|Magdalen Strait
德索尔海峡|Desolation Sound
胡安·德富卡海峡|Juan de Fuca Strait
麦基诺海峡|Straits of Mackinac
圣克莱尔海峡|St Clair Strait
底特律河海峡|Detroit River Strait
伊利湖水道|Lake Erie Waterway
圣劳伦斯河口水道|Lower Saint Lawrence Channel
曼德海峡|Mande Strait
卡纳里海峡|Canary Channel
直布罗陀东口|Eastern Gibraltar Strait
直布罗陀西口|Western Gibraltar Strait
"""),
    ("strait", "Indian Ocean", """
霍尔木兹海峡|Strait of Hormuz
曼德海峡|Bab-el-Mandeb
保克海峡|Palk Strait
保克湾口|Palk Bay Passage
八度海峡|Eight Degree Channel
九度海峡|Nine Degree Channel
十度海峡|Ten Degree Channel
马六甲海峡南口|Southern Malacca Strait
马六甲海峡北口|Northern Malacca Strait
新加坡海峡东口|Eastern Singapore Strait
新加坡海峡西口|Western Singapore Strait
曼纳海峡|Mannar Strait
保克海峡北段|Northern Palk Strait
保克海峡南段|Southern Palk Strait
苏伊士运河水道|Suez Canal Waterway
亚丁湾入口水道|Aden Entrance Passage
曼德海峡北段|Northern Bab-el-Mandeb
曼德海峡南段|Southern Bab-el-Mandeb
阿曼湾入口|Oman Entrance Passage
波斯湾入口|Persian Gulf Entrance
莫桑比克海峡北段|Northern Mozambique Channel
莫桑比克海峡南段|Southern Mozambique Channel
桑给巴尔海峡|Zanzibar Channel
马达加斯加海峡|Madagascar Channel
科摩罗海峡|Comoros Channel
马约特海峡|Mayotte Channel
马斯克林海峡|Mascarene Channel
索科特拉海峡|Socotra Channel
古德霍普海峡|Cape of Good Hope Passage
阿加勒斯海峡|Agulhas Passage
霍尔木兹海峡北段|Northern Strait of Hormuz
霍尔木兹海峡南段|Southern Strait of Hormuz
奥尔穆兹外海水道|Outer Hormuz Passage
卡奇海峡|Kutch Strait
坎贝海峡|Khambhat Strait
科伦坡海峡|Colombo Passage
马尔代夫海峡|Maldives Passage
斯里兰卡海峡|Sri Lanka Passage
拉克代夫海峡|Laccadive Channel
孟加拉湾东口水道|Eastern Bay of Bengal Passage
孟加拉湾西口水道|Western Bay of Bengal Passage
安达曼海东部水道|Eastern Andaman Passage
安达曼海西部水道|Western Andaman Passage
孟加拉湾南部水道|Southern Bay of Bengal Passage
阿拉伯海西部水道|Western Arabian Sea Passage
阿拉伯海东部水道|Eastern Arabian Sea Passage
红海入口水道|Red Sea Entrance Passage
苏伊士湾入口|Suez Gulf Entrance
亚喀巴湾入口|Aqaba Gulf Entrance
"""),
    ("strait", "Arctic Ocean", """
白令海峡|Bering Strait
戴维斯海峡|Davis Strait
丹麦海峡|Denmark Strait
弗拉姆海峡|Fram Strait
纳雷斯海峡|Nares Strait
史密斯海峡|Smith Sound
兰开斯特海峡|Lancaster Sound
巴罗海峡|Barrow Strait
麦克卢尔海峡|McClure Strait
维多利亚海峡|Victoria Strait
皮尔海峡|Peary Channel
尤里卡海峡|Eureka Sound
阿蒙森海峡|Amundsen Gulf
维尔基茨基海峡|Vilkitsky Strait
德米特里·拉普捷夫海峡|Dmitry Laptev Strait
桑尼科夫海峡|Sannikov Strait
德隆海峡|De Long Strait
喀拉海峡|Kara Strait
尤戈尔海峡|Yugor Strait
马托奇金海峡|Matochkin Strait
卡尔斯基门海峡|Karskiye Vorota
圣安娜海峡|St Anna Strait
弗朗茨约瑟夫海峡|Franz Josef Channel
斯瓦尔巴海峡|Svalbard Passage
格陵兰海峡|Greenland Passage
北极群岛西水道|Western Arctic Archipelago Passage
北极群岛东水道|Eastern Arctic Archipelago Passage
"""),
    ("strait", "Mediterranean Sea", """
奥特朗托海峡|Strait of Otranto
墨西拿海峡|Strait of Messina
博尼法乔海峡|Strait of Bonifacio
直布罗陀海峡|Strait of Gibraltar
达达尼尔海峡|Dardanelles
博斯普鲁斯海峡|Bosporus
刻赤海峡|Kerch Strait
科林斯运河水道|Corinth Canal Waterway
阿尔沃兰海峡|Alboran Passage
西西里海峡|Strait of Sicily
撒丁海峡|Sardinia Channel
科西嘉海峡|Corsica Channel
卡塔尼亚海峡|Catania Channel
潘泰莱里亚海峡|Pantelleria Channel
马耳他海峡|Malta Channel
突尼斯海峡|Tunisia Channel
利比亚海峡|Libya Passage
爱琴海达达尼尔入口|Aegean Dardanelles Entrance
爱琴海北部水道|Northern Aegean Passage
爱琴海南部水道|Southern Aegean Passage
亚得里亚海入口|Adriatic Entrance
第勒尼安海入口|Tyrrhenian Entrance
利古里亚海入口|Ligurian Entrance
黑海入口|Black Sea Entrance
马尔马拉海入口|Marmara Entrance
亚速海入口|Azov Entrance
"""),
    ("bay", "Pacific Ocean", """
东京湾|Tokyo Bay
相模湾|Sagami Bay
骏河湾|Suruga Bay
伊势湾|Ise Bay
三河湾|Mikawa Bay
若狭湾|Wakasa Bay
富山湾|Toyama Bay
仙台湾|Sendai Bay
陆奥湾|Mutsu Bay
青森湾|Aomori Bay
津轻湾|Tsugaru Bay
石狩湾|Ishikari Bay
鄂霍次克湾|Okhotsk Bay
彼得大帝湾|Peter the Great Bay
阿尼瓦湾|Aniva Bay
塔陶湾|Tatar Strait Bay
辽东湾|Liaodong Bay
渤海湾|Bohai Bay
莱州湾|Laizhou Bay
胶州湾|Jiaozhou Bay
杭州湾|Hangzhou Bay
三门湾|Sanmen Bay
象山港|Xiangshan Bay
宁波舟山湾|Ningbo Zhoushan Bay
乐清湾|Yueqing Bay
温州湾|Wenzhou Bay
泉州湾|Quanzhou Bay
厦门湾|Xiamen Bay
汕头湾|Shantou Bay
珠江口湾|Pearl River Estuary Bay
北部湾|Gulf of Tonkin
泰国湾|Gulf of Thailand
柬埔寨湾|Cambodia Bay
马尼拉湾|Manila Bay
苏比克湾|Subic Bay
拉蒙湾|Lamong Bay
达沃湾|Davao Gulf
莱特湾|Leyte Gulf
米沙鄢海湾|Visayan Gulf
巴拉望湾|Palawan Bay
班乃湾|Panay Gulf
摩鹿加湾|Molucca Bay
霍尔马海拉湾|Halmahera Bay
查亚普拉湾|Jayapura Bay
米尔恩湾|Milne Bay
科林伍德湾|Collingwood Bay
巴布亚湾|Gulf of Papua
卡奔塔利亚湾|Gulf of Carpentaria
约瑟夫·邦拿巴特湾|Joseph Bonaparte Gulf
埃克斯茅斯湾|Exmouth Gulf
鲨鱼湾|Shark Bay
斯宾塞湾|Spencer Gulf
圣文森特湾|Gulf St Vincent
杰维斯湾|Jervis Bay
赫维湾|Hervey Bay
摩顿湾|Moreton Bay
植物学湾|Botany Bay
杰克逊港湾|Port Jackson Bay
菲利普港湾|Port Phillip Bay
丰盛湾|Bay of Plenty
霍克湾|Hawke's Bay
贫困湾|Poverty Bay
金湾|Golden Bay
怀劳湾|Wairau Bay
奥克兰湾|Auckland Bay
岛屿湾|Bay of Islands
"""),
    ("bay", "Atlantic Ocean", """
圣劳伦斯湾|Gulf of Saint Lawrence
芬迪湾|Bay of Fundy
缅因湾|Gulf of Maine
切萨皮克湾|Chesapeake Bay
特拉华湾|Delaware Bay
纽约湾|New York Bay
巴尔的摩湾|Baltimore Bay
阿巴科湾|Abaco Bay
墨西哥湾|Gulf of Mexico
坎佩切湾|Bay of Campeche
洪都拉斯湾|Gulf of Honduras
加勒比湾|Caribbean Gulf
委内瑞拉湾|Gulf of Venezuela
达连湾|Gulf of Darien
巴拿马湾|Gulf of Panama
尼科亚湾|Gulf of Nicoya
丰塞卡湾|Gulf of Fonseca
特万特佩克湾|Gulf of Tehuantepec
马萨特兰湾|Mazatlan Bay
班德拉斯湾|Banderas Bay
加利福尼亚湾|Gulf of California
阿卡普尔科湾|Acapulco Bay
巴亚德洛斯安赫莱斯湾|Bay of Los Angeles
帕斯卡古拉湾|Pascagoula Bay
莫比尔湾|Mobile Bay
阿帕拉契科拉湾|Apalachee Bay
坦帕湾|Tampa Bay
佛罗里达湾|Florida Bay
大西洋城湾|Atlantic City Bay
巴芬湾|Baffin Bay
哈德逊湾|Hudson Bay
詹姆斯湾|James Bay
昂加瓦湾|Ungava Bay
圣玛格丽特湾|St Margarets Bay
布雷顿角湾|Cape Breton Bay
加斯佩湾|Gaspé Bay
夏勒湾|Chaleur Bay
圣乔治湾|St George Bay
芬迪湾东部|Eastern Bay of Fundy
芬迪湾西部|Western Bay of Fundy
比斯开湾|Bay of Biscay
加的斯湾|Gulf of Cadiz
里昂湾|Gulf of Lion
瓦伦西亚湾|Gulf of Valencia
阿尔梅里亚湾|Bay of Almeria
马拉加湾|Bay of Malaga
卡塔赫纳湾|Cartagena Bay
阿尔赫西拉斯湾|Algeciras Bay
加莱湾|Bay of Calais
塞纳湾|Bay of Seine
圣马洛湾|Bay of Saint-Malo
布列塔尼湾|Bay of Brittany
卡迪根湾|Cardigan Bay
利物浦湾|Liverpool Bay
莫克姆湾|Morecambe Bay
康威湾|Conwy Bay
加尔韦湾|Galway Bay
多尼戈尔湾|Donegal Bay
班特里湾|Bantry Bay
科克港湾|Cork Harbour Bay
克莱德湾|Firth of Clyde
福斯湾|Firth of Forth
莫里湾|Moray Firth
泰湾|Firth of Tay
"""),
    ("bay", "Indian Ocean", """
亚丁湾|Gulf of Aden
亚喀巴湾|Gulf of Aqaba
苏伊士湾|Gulf of Suez
苏伊士湾北部|Northern Gulf of Suez
亚喀巴湾北部|Northern Gulf of Aqaba
阿曼湾|Gulf of Oman
波斯湾|Persian Gulf
卡塔尔湾|Qatar Bay
巴林湾|Bahrain Bay
科威特湾|Kuwait Bay
阿曼湾东部|Eastern Gulf of Oman
曼纳湾|Gulf of Mannar
保克湾|Palk Bay
马尔塔班湾|Gulf of Martaban
卡奇湾|Gulf of Kutch
坎贝湾|Gulf of Khambhat
孟买湾|Mumbai Bay
科钦湾|Kochi Bay
马纳尔湾北部|Northern Gulf of Mannar
孟加拉湾东北部|Northeastern Bay of Bengal
孟加拉湾西北部|Northwestern Bay of Bengal
孟加拉湾西南部|Southwestern Bay of Bengal
孟加拉湾东南部|Southeastern Bay of Bengal
钦奈湾|Chennai Bay
帕克湾|Palk Bay South
马尔代夫湾|Maldives Bay
马埃湾|Mahe Bay
安齐拉纳纳湾|Antsiranana Bay
马任加湾|Mahajanga Bay
马哈努鲁湾|Mahanoro Bay
马哈赞加湾|Mahajanga Coast Bay
莫桑比克湾|Mozambique Bay
德拉戈阿湾|Delagoa Bay
索法拉湾|Sofala Bay
马普托湾|Maputo Bay
伊纳科湾|Inhaca Bay
理查德湾|Richards Bay
德拉肯斯湾|Drakensberg Bay
阿尔戈湾|Algoa Bay
福尔斯湾|False Bay
桌湾|Table Bay
沃尔维斯湾|Walvis Bay
吕德里茨湾|Luderitz Bay
鲸湾|Walvis Coast Bay
马斯克林湾|Mascarene Bay
塞舌尔湾|Seychelles Bay
科摩罗湾|Comoros Bay
桑给巴尔湾|Zanzibar Bay
达累斯萨拉姆湾|Dar es Salaam Bay
坦噶湾|Tanga Bay
蒙巴萨湾|Mombasa Bay
索马里湾|Somali Gulf
"""),
    ("fjord", "Atlantic Ocean", """
松恩峡湾|Sognefjord
哈当厄尔峡湾|Hardangerfjord
奥斯陆峡湾|Oslofjord
特隆赫姆峡湾|Trondheimsfjord
盖朗厄尔峡湾|Geirangerfjord
罗姆斯达尔峡湾|Romsdalsfjord
诺德峡湾|Nordfjord
松恩峡湾内湾|Inner Sognefjord
哈当厄尔峡湾内湾|Inner Hardangerfjord
利勒峡湾|Lillefjord
波拉峡湾|Porsangerfjord
瓦朗厄尔峡湾|Varangerfjord
特隆赫姆峡湾外湾|Outer Trondheimsfjord
奥斯陆峡湾外湾|Outer Oslofjord
吕瑟峡湾|Lysefjord
纳柔依峡湾|Naeroyfjord
奥尔登峡湾|Oldenfjord
诺拉峡湾|Norfjord
伊萨峡湾|Isafjordur
埃亚峡湾|Eyjafjordur
斯卡尔峡湾|Skalfjordur
伊萨峡湾外湾|Outer Isafjordur
康格斯峡湾|Kongsfjord
伊斯峡湾|Isfjorden
霍恩松峡湾|Hornsund
玛格达莱娜湾|Magdalenefjord
伍德峡湾|Woodfjorden
比尔斯峡湾|Billefjorden
范米恩峡湾|Van Mijenfjorden
格陵兰北部峡湾|North Greenland Fjord
斯科斯比湾|Scoresby Sound
卡内基峡湾|Kane Basin Fjord
肯尼迪海峡峡湾|Kennedy Channel Fjord
迪斯科湾|Disko Bay Fjord
伊卢利萨特峡湾|Ilulissat Icefjord
努克峡湾|Nuuk Fjord
戈特霍布峡湾|Godthab Fjord
塔西拉克峡湾|Tasiilaq Fjord
哈德逊海峡峡湾|Hudson Strait Fjord
拉布拉多峡湾|Labrador Fjord
安达曼峡湾|Andaman Fjord
米尔福德峡湾|Milford Sound
道特富尔峡湾|Doubtful Sound
达斯基峡湾|Dusky Sound
玛丽安峡湾|Marlborough Sounds
皇后夏洛特峡湾|Queen Charlotte Sound
金钟湾|Admiralty Bay
马尔堡峡湾|Marlborough Sound
阿拉斯加冰川湾|Glacier Bay
普林斯威廉湾|Prince William Sound
库克湾|Cook Inlet
基奈峡湾|Kenai Fjords
"""),
    ("fjord", "Southern Ocean", """
威德尔海|Weddell Sea
罗斯海|Ross Sea
阿蒙森海|Amundsen Sea
别林斯高晋海|Bellingshausen Sea
斯科舍海|Scotia Sea
拉扎列夫海|Lazarev Sea
里瑟-拉森海|Riiser-Larsen Sea
宇航员海|Cosmonauts Sea
合作海|Cooperation Sea
戴维斯海|Davis Sea
莫森海|Mawson Sea
索莫夫海|Somov Sea
杜蒙·迪于维尔海|Dumont d'Urville Sea
国王豪康七世海|King Haakon VII Sea
普里兹湾|Prydz Bay
阿蒙森湾|Amundsen Bay
玛格丽特湾|Marguerite Bay
阿德利海岸海域|Adelie Coast Sea
毛德皇后地海域|Queen Maud Land Sea
埃尔斯沃思地海域|Ellsworth Land Sea
南设得兰群岛海域|South Shetland Sea
南奥克尼海域|South Orkney Sea
南乔治亚海域|South Georgia Sea
布兰斯菲尔德海峡|Bransfield Strait
南极半岛西海域|West Antarctic Peninsula Sea
南极半岛东海域|East Antarctic Peninsula Sea
威德尔海北部|Northern Weddell Sea
威德尔海南部|Southern Weddell Sea
罗斯海西部|Western Ross Sea
罗斯海东部|Eastern Ross Sea
阿蒙森海西部|Western Amundsen Sea
别林斯高晋海西部|Western Bellingshausen Sea
"""),
)


def _parse_groups() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for kind, parent, raw in _GROUPS:
        for raw_line in raw.strip().splitlines():
            line = raw_line.strip()
            if not line or "|" not in line:
                continue
            name_zh, name_en = (part.strip() for part in line.split("|", 1))
            rows.append({"name": name_zh, "name_en": name_en, "kind": kind, "parent": parent})
    return rows


def _deduplicate(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        key = str(row["name_en"]).casefold()
        if key in seen:
            continue
        seen.add(key)
        name_en = str(row["name_en"])
        kind = str(row["kind"])
        lowered_name = name_en.casefold()
        if name_en in _OCEAN_NAMES_EN:
            kind = "ocean"
        elif "fjord" in lowered_name or lowered_name.endswith(" sound"):
            kind = "fjord"
        elif "strait" in lowered_name:
            kind = "strait"
        elif "channel" in lowered_name or "passage" in lowered_name:
            kind = "channel"
        elif lowered_name.startswith("gulf of ") or lowered_name.endswith(" gulf") or " bight" in lowered_name:
            kind = "gulf"
        elif lowered_name.startswith("bay of ") or lowered_name.endswith(" bay"):
            kind = "bay"
        lon_lat_radius = _SPATIAL.get(name_en)
        parent = name_en if kind == "ocean" else str(row["parent"])
        item = {
            "name": str(row["name"]),
            "name_en": name_en,
            "place_type": _KIND_ZH.get(kind, "海"),
            "kind": kind,
            "parent": parent,
            "parent_zh": _PARENT_ZH.get(parent, parent),
            "source_url": ATLAS_SOURCE_URL,
            "atlas_version": ATLAS_VERSION,
            # A stable row id makes the long-tail catalogue auditable in the
            # UI and prevents a generic paragraph from standing in for a
            # named feature.
            "atlas_index": len(output) + 1,
        }
        if lon_lat_radius:
            item["center"] = {"longitude": lon_lat_radius[0], "latitude": lon_lat_radius[1]}
            item["radius_km"] = lon_lat_radius[2]
            item["spatial_status"] = "catalogue-centre"
        else:
            item["spatial_status"] = "name-only"
        output.append(item)
    return output


MARINE_ATLAS: tuple[dict[str, Any], ...] = tuple(_deduplicate(_parse_groups()))
MARINE_ATLAS_BY_EN: dict[str, dict[str, Any]] = {entry["name_en"].casefold(): entry for entry in MARINE_ATLAS}
MARINE_ATLAS_BY_ZH: dict[str, dict[str, Any]] = {entry["name"]: entry for entry in MARINE_ATLAS}


def _haversine_km(lon_a: float, lat_a: float, lon_b: float, lat_b: float) -> float:
    phi1, phi2 = radians(lat_a), radians(lat_b)
    d_phi = radians(lat_b - lat_a)
    d_lambda = radians(lon_b - lon_a)
    value = sin(d_phi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(d_lambda / 2) ** 2
    return 6371.0088 * 2 * asin(min(1.0, sqrt(value)))


def _rank(entry: dict[str, Any]) -> tuple[int, float]:
    # Smaller named features win over a broad basin when both contain a point.
    kind_rank = {"strait": 0, "channel": 0, "passage": 0, "fjord": 1, "bay": 2, "gulf": 2, "sea": 3, "ocean": 4}
    return (kind_rank.get(str(entry.get("kind")), 3), float(entry.get("radius_km") or 99999.0))


def lookup_marine_atlas(longitude: float, latitude: float) -> dict[str, Any] | None:
    """Return the best local named feature for a point, if a spatial record exists."""
    candidates: list[tuple[tuple[int, float, float], dict[str, Any]]] = []
    for entry in MARINE_ATLAS:
        center = entry.get("center")
        radius = entry.get("radius_km")
        if not isinstance(center, dict) or not isinstance(radius, (int, float)):
            continue
        distance = _haversine_km(longitude, latitude, float(center["longitude"]), float(center["latitude"]))
        if distance <= float(radius):
            kind_rank, radius_rank = _rank(entry)
            candidates.append(((kind_rank, radius_rank, distance), entry))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0])
    selected = dict(candidates[0][1])
    selected["distance_km"] = round(candidates[0][0][2], 1)
    selected["confidence"] = "high" if candidates[0][0][0] <= 2 else "medium"
    return selected


def atlas_entry(name: str | None) -> dict[str, Any] | None:
    """Find a catalogue entry by either its Chinese or English canonical name."""
    if not name:
        return None
    value = str(name).strip()
    return MARINE_ATLAS_BY_ZH.get(value) or MARINE_ATLAS_BY_EN.get(value.casefold())


def atlas_search(query: str | None = None, *, limit: int = 50) -> list[dict[str, Any]]:
    """Search the offline atlas for UI pickers and diagnostics."""
    needle = str(query or "").strip().casefold()
    rows = [
        entry
        for entry in MARINE_ATLAS
        if not needle
        or needle in entry["name"].casefold()
        or needle in normalize_political_language(entry["name"]).casefold()
        or needle in entry["name_en"].casefold()
    ]
    return [normalize_text_fields(dict(entry)) for entry in rows[: max(1, min(int(limit), 500))]]


def _coordinate_label(value: float, positive: str, negative: str) -> str:
    direction = positive if value >= 0 else negative
    return f"{direction}{abs(value):.2f}°"


def atlas_fact_sheet(entry: dict[str, Any]) -> list[str]:
    """Narrative facts must come from a versioned authority snapshot."""
    return []


def atlas_profile(entry: dict[str, Any]) -> dict[str, Any]:
    """Return lookup keys only; the atlas is not a narrative source."""
    name = str(entry["name"])
    name_en = str(entry["name_en"])
    place_type = str(entry["place_type"])
    parent_zh = str(entry.get("parent_zh") or entry.get("parent") or "海洋")
    kind = str(entry.get("kind") or "sea")
    return {
        "overview": "",
        "historical_significance": [],
        "human_geography": [],
        "maritime_routes": [],
        "coastal_livelihoods": [],
        "marine_culture": [],
        "key_terms": [name, name_en, parent_zh, place_type, kind],
        "wiki_pages": [name, name_en],
        "fact_sheet": [],
        **atlas_supplement(entry),
    }


def atlas_supplement(entry: dict[str, Any]) -> dict[str, list[str]]:
    """Learning layers are populated only from versioned authority content."""
    return {
        "physical_geography": [],
        "oceanographic_processes": [],
        "ecosystems": [],
        "learning_prompts": [],
    }


def atlas_profile_map() -> dict[str, dict[str, Any]]:
    return {entry["name_en"]: atlas_profile(entry) for entry in MARINE_ATLAS}


__all__ = [
    "ATLAS_SOURCE_URL",
    "ATLAS_VERSION",
    "MARINE_ATLAS",
    "MARINE_ATLAS_BY_EN",
    "MARINE_ATLAS_BY_ZH",
    "atlas_entry",
    "atlas_fact_sheet",
    "atlas_profile",
    "atlas_profile_map",
    "atlas_supplement",
    "atlas_search",
    "lookup_marine_atlas",
]

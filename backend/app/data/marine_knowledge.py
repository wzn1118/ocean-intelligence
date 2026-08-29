"""Marine-region human geography and history knowledge.

The interactive map uses this module as a second, slower enrichment layer after
the coordinate and observation lookup. Curated regional facts provide a stable
fallback; Wikimedia summaries add a live, traceable synopsis when available.
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlencode

from app.data.baidu_baike import get_baidu_baike_introduction
from app.data.chinese_text import (
    REJECTED_POLITICAL_PHRASES,
    contains_traditional_chinese,
    normalize_text_fields,
    normalize_wikipedia_article,
    text_values,
    unprefixed_china_region_terms,
)

from app.data.marine_atlas import (
    ATLAS_SOURCE_URL,
    ATLAS_VERSION,
    MARINE_ATLAS,
    atlas_entry,
    atlas_profile,
    atlas_profile_map,
)
from app.data.china_coastal_areas import CHINA_MARINE_BAIKE_NAMES, lookup_china_coastal_area

from app.data.marine_context import (
    MARINE_REGIONS_URL,
    _fao_area,
    _fallback_sea,
    _http_json,
    _marine_regions,
    _normalize_fao_area,
    _normalize_place,
    _select_primary_place,
)
from app.data.marine_encyclopedia import (
    encyclopedia_snapshot_metadata,
    offline_wikipedia_article,
)


KNOWLEDGE_CACHE_TTL_SECONDS = 6 * 60 * 60
KNOWLEDGE_CACHE_MAX_ENTRIES = 256
WIKIMEDIA_API = "https://zh.wikipedia.org/w/api.php"

# These labels came from unsourced prose rather than a taxonomic catalogue.
# Reject them at the response boundary so a future content edit cannot silently
# put fabricated or placeholder species names back into the interface.
REJECTED_UNVERIFIED_SPECIES_TERMS: tuple[str, ...] = (
    "极地鳄",
    "北极鱼",
    "新西兰浪漫鱼",
    "大洋鱼",
    "南极云鸠",
    "鲁鱼",
    "鲜蝦",
)

AUTHORITY_NARRATIVE_FIELDS: tuple[str, ...] = (
    "historical_significance",
    "human_geography",
    "maritime_routes",
    "coastal_livelihoods",
    "marine_culture",
    "fact_sheet",
    "physical_geography",
    "oceanographic_processes",
    "ecosystems",
    "learning_prompts",
)

REJECTED_PLACEHOLDER_PHRASES: tuple[str, ...] = (
    "历史资料检索键",
    "名称检索：",
    "数据解释：",
    "证据边界：",
    "资料边界：",
    "本条目按该名称提供",
    "过程标签：",
    "生态入口：",
    "下一步怎么探索",
    "再判断异常是否具有区域代表性",
)

VERIFIED_LIVELIHOOD_EVIDENCE = (
    "物种与渔业生计信息仅在点位记录同时通过 OBIS 出现记录、"
    "WoRMS 接受名和 FAO ASFIS 物种名录核验后提供。"
)

_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_cache_lock = threading.Lock()


def _profile(
    overview: str,
    history: list[str],
    human_geography: list[str],
    routes: list[str],
    livelihoods: list[str],
    culture: list[str],
    terms: list[str],
    pages: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "overview": overview,
        "historical_significance": history,
        "human_geography": human_geography,
        "maritime_routes": routes,
        "coastal_livelihoods": livelihoods,
        "marine_culture": culture,
        "key_terms": terms,
        # Existing profiles can use their key terms as live article titles;
        # explicit page lists remain available for regions that need them.
        "wiki_pages": pages if pages is not None else terms[:2],
        "fact_sheet": [overview],
    }


REGIONAL_PROFILES: dict[str, dict[str, Any]] = {
    "South China Sea": _profile(
        "南海是连接东亚、东南亚与印度洋的重要边缘海，岛礁、陆架和深海盆地共同构成复杂的海洋空间。",
        [
            "南海长期处在海上丝绸之路航线上，沿岸港口承担了贸易、移民与文化交流功能。",
            "中国南部沿海、东南亚岛屿和中南半岛的海洋社会，在渔业、航运和季风贸易中形成了持续联系。",
        ],
        [
            "沿岸人口密集，珠江口、湄公河三角洲和吕宋岛等区域把河口城市与近海资源紧密连接。",
            "海域周边包含多个语言、宗教和港口传统交汇的海洋文化圈。",
        ],
        [
            "季风和海峡共同影响东亚至马六甲海峡的航行节律。",
            "南海是连接东亚港口、东南亚群岛与印度洋航线的关键通道。",
        ],
        [
            "近岸捕捞、养殖、港口物流和海上旅游是沿岸常见生计类型。",
            "珊瑚礁、红树林和河口湿地同时支撑渔业资源与海岸防护。",
        ],
        ["妈祖信仰", "海上丝绸之路", "渔港", "季风航海"],
        ["南海", "海上丝绸之路", "妈祖"],
    ),
    "East China Sea": _profile(
        "东海是中国东部陆架海，长江口、中国台湾海峡和琉球岛链把河口、岛屿与西北太平洋联系起来。",
        [
            "长江口和宁波、泉州等港口长期参与东亚海上贸易网络。",
            "东海沿岸的航海、渔业与港市文化受到季风、潮汐和河口沉积环境的共同塑造。",
        ],
        [
            "沿岸城市密集，长江三角洲是人口、产业和港口活动高度集中的海岸带。",
            "中国台湾海峡和琉球岛链形成多个岛屿社会与跨海交通节点。",
        ],
        ["长江口—东海陆架航线", "中国台湾海峡通道", "东亚近海港口网络"],
        ["近海捕捞", "贝类和海水养殖", "港口运输", "河口湿地利用"],
        ["海上丝绸之路", "渔港文化", "河口城市"],
        ["东海", "长江口", "中国台湾海峡"],
    ),
    "Yellow Sea": _profile(
        "黄海是半封闭浅海，宽广潮滩、河口和陆架环境使其成为东亚重要的渔业与候鸟迁徙海域。",
        [
            "黄海沿岸港口和潮滩社区长期依赖季节性渔业、盐业与海岸贸易。",
            "沿岸海港在东北亚海运和区域城市发展中持续发挥作用。",
        ],
        ["渤海湾、山东半岛、朝鲜半岛西岸和长江口共同构成黄海沿岸社会网络。", "潮滩是渔民、盐业和候鸟共享的海岸空间。"],
        ["黄海沿岸港口航线", "东北亚近海运输网络"],
        ["潮滩贝类采集", "近海捕捞", "盐业与海水养殖", "港口物流"],
        ["潮汐知识", "渔港节律", "候鸟与湿地保护"],
        ["黄海", "潮滩", "黄海生态区"],
    ),
    "Bohai Sea": _profile(
        "渤海是中国北方的内海，辽东湾、渤海湾和莱州湾共同构成浅海、河口与港口密集的海岸系统。",
        [
            "渤海沿岸港口与京津冀、辽东和山东半岛的陆海交通长期相连。",
            "古代沿海盐业、渔业和海运活动塑造了湾内城镇与海岸聚落。",
        ],
        ["海岸带人口和工业活动密集，海湾环境与城市、港口和河流输入关系紧密。", "辽东半岛与山东半岛形成湾口两侧的海岸文化联系。"],
        ["天津港—渤海湾航线", "环渤海港口群", "辽东—山东近海航线"],
        ["近岸捕捞", "贝类养殖", "港口物流", "河口湿地保护"],
        ["海盐传统", "渔港聚落", "环渤海城市文化"],
        ["渤海", "渤海湾", "辽东湾", "莱州湾"],
    ),
    "Philippine Sea": _profile(
        "菲律宾海位于西北太平洋深水区，海沟、岛弧和黑潮共同形成深海环流与岛屿社会相邻的海洋空间。",
        ["菲律宾群岛、日本琉球和太平洋岛屿之间长期存在航海、迁徙与贸易联系。", "岛屿社会的航海知识与季风、洋流和台风路径密切相关。"],
        ["菲律宾群岛和琉球岛链把深海盆地与密集岛屿聚落连接起来。", "沿岸社会同时面对渔业机会、台风风险和岛屿交通约束。"],
        ["黑潮主通道", "西北太平洋岛链航线", "东亚—太平洋跨海航线"],
        ["远洋捕捞", "岛屿渔业", "港口运输", "海洋旅游"],
        ["岛屿航海", "台风知识", "海岛渔村"],
        ["菲律宾海", "黑潮", "西北太平洋"],
    ),
    "Coral Sea": _profile(
        "珊瑚海位于澳大利亚东北和新喀里多尼亚之间，以大堡礁、珊瑚礁生态系统和南太平洋岛屿联系著称。",
        ["太平洋岛民的传统航海和岛屿交换网络跨越珊瑚海及其周边海域。", "近代以来珊瑚礁考察、航运与海洋保护共同影响区域叙事。"],
        ["澳大利亚东北沿岸、巴布亚新几内亚和太平洋岛屿构成多岛屿人文地理。", "岛礁、海岸社区和保护区之间存在长期资源管理关系。"],
        ["大堡礁沿岸航线", "南太平洋岛链航线", "澳大利亚东北近海航线"],
        ["珊瑚礁渔业", "海洋旅游", "岛屿交通", "保护区管理"],
        ["传统航海", "珊瑚礁知识", "岛屿社区"],
        ["珊瑚海", "大堡礁", "太平洋岛屿"],
    ),
    "Mediterranean Sea": _profile(
        "地中海是连接欧洲、北非和西亚的半封闭海，海峡、群岛和港口城市构成高度连续的人文海岸。",
        ["地中海长期是古代文明、宗教、贸易和人口迁徙相互作用的海域。", "港口城市和海峡控制了欧亚非之间的商品、技术与文化传播。"],
        ["欧洲南岸、北非和西亚沿岸形成多语言、多宗教和多港口文化圈。", "河口、岛屿和海峡让区域历史始终具有跨海特征。"],
        ["直布罗陀海峡通道", "苏伊士—地中海航线", "爱琴海与亚得里亚海港口网络"],
        ["近海捕捞", "港口贸易", "海岸旅游", "橄榄农业与海岸城市经济"],
        ["古典文明", "港口城市", "海峡与群岛"],
        ["地中海", "直布罗陀海峡", "苏伊士运河"],
    ),
}


# The atlas is deliberately shipped with the service: a temporary outage of an
# external encyclopedia must not turn a clicked sea into an empty explanation.
# Aliases cover variants returned by Marine Regions and common map labels.
REGIONAL_PROFILES["Gulf of Mexico"] = _profile(
    "\u58a8\u897f\u54e5\u6e7e\u662f\u5317\u7f8e\u6d32\u5357\u90e8\u7684\u534a\u5c01\u95ed\u6d77\uff1b\u5317\u5cb8\u8fde\u63a5\u7f8e\u56fd\u6e7e\u5cb8\u5dde\uff0c\u897f\u5cb8\u548c\u5357\u5cb8\u8fde\u63a5\u58a8\u897f\u54e5\u3002\u4f5b\u7f57\u91cc\u8fbe\u6d77\u5ce1\u4e0e\u5c24\u5361\u5766\u6d77\u5ce1\u5206\u522b\u8fde\u63a5\u5927\u897f\u6d0b\u548c\u52a0\u52d2\u6bd4\u6d77\u3002",
    [
        "19\u4e16\u7eaa40\u5e74\u4ee3\uff0c\u4f5b\u7f57\u91cc\u8fbe\u5dde\u5f6d\u8428\u79d1\u62c9\u9644\u8fd1\u5df2\u5f62\u6210\u7ea2\u9cb7\u6e14\u4e1a\uff1b\u51b7\u85cf\u548c\u94c1\u8def\u666e\u53ca\u540e\uff0c\u8239\u961f\u5ef6\u957f\u4f5c\u4e1a\u65f6\u95f4\u5e76\u6269\u5927\u4e86\u6e14\u83b7\u5e02\u573a\u3002",
        "19\u4e16\u7eaa\u672b\u81f320\u4e16\u7eaa\u521d\uff0c\u7f8e\u56fd\u8239\u961f\u5c06\u7ea2\u9cb7\u4f5c\u4e1a\u6269\u5c55\u5230\u58a8\u897f\u54e5\u574e\u4f69\u5207\u6d45\u6ee9\uff1b1984\u5e74\u8d77\uff0c\u7f8e\u56fd\u5b9e\u65bd\u58a8\u897f\u54e5\u6e7e\u7901\u9c7c\u8d44\u6e90\u7ba1\u7406\u8ba1\u5212\u3002",
    ],
    [
        "\u65b0\u5965\u5c14\u826f\u3001\u83ab\u6bd4\u5c14\u3001\u5f6d\u8428\u79d1\u62c9\u3001\u52a0\u5c14\u7ef4\u65af\u987f\u548c\u5766\u5e15\u662f\u5317\u90e8\u6e7e\u5cb8\u7684\u6e2f\u53e3\u4e0e\u6e14\u4e1a\u7269\u6d41\u8282\u70b9\u3002",
        "\u5bc6\u897f\u897f\u6bd4\u6cb3\u4e09\u89d2\u6d32\u6e7f\u5730\u3001\u8def\u6613\u65af\u5b89\u90a3\u6cbc\u6cfd\u548c\u4f5b\u7f57\u91cc\u8fbe\u6e7e\u5171\u540c\u652f\u6491\u6e14\u4e1a\u3001\u822a\u8fd0\u3001\u6e7f\u5730\u4fdd\u62a4\u4e0e\u6ee8\u6d77\u793e\u533a\u3002",
    ],
    [
        "\u5bc6\u897f\u897f\u6bd4\u6cb3\u53e3\u5c06\u5317\u7f8e\u5185\u9646\u8d27\u8fd0\u8fde\u63a5\u81f3\u5317\u90e8\u6e7e\uff1b\u4f5b\u7f57\u91cc\u8fbe\u6d77\u5ce1\u548c\u5c24\u5361\u5766\u6d77\u5ce1\u662f\u4e24\u6761\u5bf9\u5916\u4ea4\u6362\u901a\u9053\u3002",
        "\u5317\u90e8\u6e7e\u5cb8\u6e2f\u53e3\u7f51\u7edc\u627f\u62c5\u6e14\u83b7\u3001\u80fd\u6e90\u4e0e\u96c6\u88c5\u7bb1\u8f6c\u8fd0\uff1b\u5177\u4f53\u6e2f\u53e3\u6d3b\u52a8\u7531\u6e2f\u53e3\u7edf\u8ba1\u8fdb\u4e00\u6b65\u6838\u9a8c\u3002",
    ],
    [
        "NOAA\u5730\u9762\u8c03\u67e5\u4e2d\u6709\u7ea2\u9cb7\u3001\u5317\u65b9\u8910\u867e\u3001\u5927\u897f\u6d0b\u77f3\u9996\u9c7c\u548c\u58a8\u897f\u54e5\u6e7e\u6bd4\u76ee\u9c7c\u7b49\u91cd\u70b9\u79cd\u3002",
        "\u8fd1\u5cb8\u751f\u8ba1\u8fd8\u5305\u62ec\u6591\u70b9\u6d77\u9cd7\u3001\u6761\u7eb9\u9ca8\u9c7c\u3001\u84dd\u87f9\u548c\u7261\u86ce\uff1b\u8fd9\u4e9b\u79cd\u7c7b\u5728\u5dde\u9645\u6e14\u4e1a\u7ba1\u7406\u8d44\u6599\u4e2d\u6709\u957f\u671f\u8bb0\u5f55\u3002",
    ],
    [
        "\u65b0\u5965\u5c14\u826f\u3001\u8def\u6613\u65af\u5b89\u90a3\u6d77\u5cb8\u4e0e\u4f5b\u7f57\u91cc\u8fbe\u6e7e\u7684\u6e2f\u53e3\u3001\u6e14\u6751\u548c\u6e7f\u5730\u793e\u533a\u5f62\u6210\u4e86\u6e7e\u5cb8\u6587\u5316\u5e26\u3002",
        "\u7ea2\u9cb7\u548c\u867e\u7c7b\u6e14\u4e1a\u662f\u6e7e\u5cb8\u6d77\u6d0b\u793e\u4f1a\u4e2d\u6709\u660e\u786e\u5386\u53f2\u6863\u6848\u7684\u4ea7\u4e1a\u6848\u4f8b\u3002",
    ],
    ["\u58a8\u897f\u54e5\u6e7e", "\u7ea2\u9cb7", "\u5317\u65b9\u8910\u867e", "\u5bc6\u897f\u897f\u6bd4\u6cb3\u4e09\u89d2\u6d32", "\u4f5b\u7f57\u91cc\u8fbe\u6d77\u5ce1", "\u5c24\u5361\u5766\u6d77\u5ce1"],
    ["\u58a8\u897f\u54e5\u6e7e", "Gulf of Mexico"],
)

PROFILE_ALIASES = {
    "Mexico Gulf": "Gulf of Mexico",
    "Gulf of America": "Gulf of Mexico",
    "Northern South China Sea": "South China Sea",
    "Southern South China Sea": "South China Sea",
}

PROFILE_REFERENCES: dict[str, list[dict[str, str]]] = {
    "Gulf of Mexico": [
        {"id": "noaa-red-snapper-history", "title": "NOAA: \u58a8\u897f\u54e5\u6e7e\u7ea2\u9cb7\u7ba1\u7406\u5386\u53f2", "source_name": "NOAA Fisheries", "url": "https://www.fisheries.noaa.gov/southeast/sustainable-fisheries/history-management-gulf-america-red-snapper"},
        {"id": "noaa-gulf-groundfish", "title": "NOAA: \u58a8\u897f\u54e5\u6e7e\u5730\u9762\u8c03\u67e5", "source_name": "NOAA Fisheries", "url": "https://www.fisheries.noaa.gov/southeast/science-data/summer-and-fall-groundfish-surveys-gulf-mexico"},
        {"id": "epa-gulf", "title": "EPA: \u4fdd\u62a4\u58a8\u897f\u54e5\u6e7e\u7684\u91cd\u8981\u6027", "source_name": "U.S. EPA", "url": "https://www.epa.gov/gulfofamerica/why-it-important-protect-gulf-america"},
    ],
}

# Specific encyclopedia-style facts for the largest named ocean systems. These
# are kept separate from the short narrative groups so the UI can show concrete
# geography, circulation, ecology and human-history facts without reusing prose
# templates for every atlas row.
REGIONAL_FACT_SHEETS: dict[str, list[str]] = {
    "Indian Ocean": [
        "地理范围：北接亚洲大陆和阿拉伯半岛，西邻东非，东以印度尼西亚群岛和澳大利亚为界，南部与南大洋相接。",
        "尺度：面积约7,056万平方千米，平均深度约3,741米；爪哇海沟和蒂阿曼蒂那海沟构成主要深海地形。",
        "水文输入：印度河、恒河—布拉马普特拉河、伊洛瓦底江和赞比西河等，把淡水、泥沙和营养盐带入海盆。",
        "季风环流：北半球冬季东北季风使阿拉伯海表层流向西南；夏季西南季风增强后，表层流向发生季节性反转。",
        "主要洋流：索马里洋流、南赤道洋流、莫桑比克洋流和西澳洋流共同组成印度洋的季节性环流网络。",
        "上升流：索马里沿岸和苏门答腊—爪哇南部存在季风驱动的上升流，会把深层营养盐带到表层并影响叶绿素与渔场。",
        "交通节点：霍尔木兹海峡、曼德海峡、马六甲海峡和苏伊士运河，把波斯湾、红海、地中海、太平洋与印度洋连接起来。",
        "生态与资源：阿拉伯海、孟加拉湾和赤道海域的初级生产力具有季节变化；具体鱼类、贝类和甲壳类以点位附近的FAO与OBIS记录为准。",
        "人文历史：季风周期支撑东非、阿拉伯半岛、印度次大陆和东南亚之间的季节性航海、港口贸易与文化交流。",
    ],
    "Pacific Ocean": [
        "地理范围：太平洋位于亚洲、大洋洲和美洲之间，北接北冰洋，南部经南大洋与南极洲相连。",
        "尺度与地形：太平洋是面积最大的洋区，马里亚纳海沟形成全球最深的海底地形，西部岛弧和海沟密集。",
        "环流系统：北太平洋和南太平洋副热带环流、黑潮、加利福尼亚洋流和秘鲁寒流共同组织表层热量输运。",
        "海气过程：厄尔尼诺—南方涛动会改变赤道太平洋海温、降水、上升流和远距离渔业生产力。",
        "生态与资源：赤道上升流和东部边界流是高生产力区，金枪鱼、鱿鱼、鲐鱼等资源应以具体点位记录核验。",
        "人文历史：波利尼西亚传统航海利用星象、风浪和洋流连接岛屿社会；现代跨太平洋航线连接东亚、美洲和大洋洲港口。",
    ],
    "Atlantic Ocean": [
        "地理范围：大西洋位于美洲与欧洲、非洲之间，北部经北冰洋相连，南部经南大洋通向南极洲。",
        "地形骨架：大西洋中脊从北向南贯穿海盆，将海盆分成东西两侧；加勒比海、墨西哥湾和地中海是重要边缘海。",
        "环流系统：湾流、北大西洋漂流、加那利洋流、巴西洋流和本格拉洋流构成经向热盐输运的重要部分。",
        "气候联系：北大西洋海温和海气交换影响欧洲西部气候，热带大西洋也是飓风生成和传播的重要区域。",
        "生态与资源：北大西洋鳕鱼、鲭鱼、金枪鱼、龙虾和贝类等资源分布必须结合具体渔区和物种记录判断。",
        "人文历史：跨大西洋航线长期连接欧洲、非洲和美洲港口，海底电缆、移民航线和现代集装箱航运均沿此展开。",
    ],
    "Arctic Ocean": [
        "地理范围：北冰洋被欧亚大陆和北美大陆环绕，通过弗拉姆海峡、巴伦支海和白令海峡与其他洋区交换。",
        "海冰过程：多年冰、季节冰和融冰边缘随季节移动，海冰覆盖变化会直接影响反照率、航行窗口和生态栖息地。",
        "水体交换：大西洋入流水和太平洋入流水分别从不同通道进入北冰洋，淡水输入与海冰融化共同影响盐度分层。",
        "环流特征：博福特环流储存淡水，跨极漂流把海冰和上层水从西伯利亚陆架输送向弗拉姆海峡。",
        "生态与资源：北极鳕、海豹、海象、北极熊和冰缘浮游生物依赖海冰与陆架环境，物种判断需引用观测记录。",
        "人文历史：北方海航道、东北航道和因纽特沿岸社区都受到海冰季节、补给港和极地天气的共同约束。",
    ],
    "Southern Ocean": [
        "地理范围：南大洋环绕南极洲，通常以南纬60度附近作为北界，与大西洋、印度洋和太平洋连续相接。",
        "环流骨架：南极绕极流自西向东环绕南极，是全球唯一贯通三大洋的连续表层洋流。",
        "锋面与混合：极锋、南极陆坡流和深层水上涌控制热量、碳和营养盐在南极海域的交换。",
        "海冰季节：海冰范围在冬季扩张、夏季退缩，冰缘带是磷虾、鲸类、海豹和海鸟的重要觅食区域。",
        "碳循环：南大洋通过冷水下沉、上升流和生物泵吸收并再分配大气二氧化碳，是全球气候系统的重要调节区。",
        "人文历史：南极科考航线、补给港和海冰预报共同决定科考船的季节性航行窗口。",
    ],
}

# Fine-grained offline atlas entries. These are keyed by named seas/straits,
# so a point remains informative even when a remote gazetteer is unavailable.
REGIONAL_PROFILES.update({
    "Gulf of Thailand": _profile(
        "\u6cf0\u56fd\u6e7e\u662f\u5357\u6d77\u897f\u90e8\u7684\u6d45\u6d77\u6e7e\uff0c\u6e7e\u9876\u8fde\u63a5\u6cf0\u56fd\u3001\u67ec\u57d4\u5be8\u548c\u8d8a\u5357\u6cbf\u5cb8\uff0c\u6d77\u5cb8\u5305\u542b\u6cb3\u53e3\u3001\u6ce5\u6ee9\u548c\u73ca\u745a\u5c9b\u5c7f\u3002",
        ["\u66fc\u8c37\u3001\u4f5b\u5854\u4e9a\u548c\u6e2f\u53e3\u57ce\u9547\u957f\u671f\u53c2\u4e0e\u6e7e\u5185\u6cbf\u5cb8\u8d38\u6613\u4e0e\u6e14\u4e1a\u3002"],
        ["\u6cf0\u56fd\u6e7e\u6cbf\u5cb8\u7684\u6cb3\u53e3\u57ce\u5e02\u3001\u6e14\u6751\u3001\u6c34\u4ea7\u517b\u6b96\u533a\u4e0e\u65c5\u6e38\u6e2f\u53e3\u5171\u5b58\u3002"],
        ["\u66fc\u8c37\u6e7e\u548c\u9a6c\u516d\u7532\u6d77\u5ce1\u4e4b\u95f4\u7684\u822a\u8fd0\u8def\u7ecf\u8fc7\u6e7e\u53e3\u6e2f\u7fa4\u3002"],
        ["\u6d77\u9c88\u3001\u867e\u3001\u77f3\u6591\u9c7c\u3001\u7ea2\u6811\u6797\u87f9\u548c\u7261\u86ce\u662f\u8fd1\u6d77\u6e14\u4e1a\u548c\u517b\u6b96\u7684\u5177\u4f53\u5bf9\u8c61\u3002"],
        ["\u6cb3\u53e3\u6ce5\u6ee9\u3001\u7ea2\u6811\u6797\u548c\u4f20\u7edf\u6e14\u6751\u6784\u6210\u6e7e\u5cb8\u6587\u5316\u666f\u89c2\u3002"],
        ["\u6cf0\u56fd\u6e7e", "\u6e7e\u5185\u6e14\u4e1a", "\u7ea2\u6811\u6797"], ["\u6cf0\u56fd\u6e7e", "Gulf of Thailand"],
    ),
    "Gulf of Tonkin": _profile(
        "\u5317\u90e8\u6e7e\u662f\u5357\u6d77\u897f\u5317\u90e8\u7684\u6d77\u6e7e\uff0c\u6e7e\u9876\u9760\u8fd1\u5317\u90e8\u6e7e\u5cb8\u548c\u7ea2\u6cb3\u3001\u73e0\u6c5f\u53e3\uff0c\u6d77\u57df\u73af\u5883\u53d7\u5b63\u98ce\u3001\u6cb3\u53e3\u6de1\u6c34\u548c\u6f6e\u6c50\u5171\u540c\u5f71\u54cd\u3002",
        ["\u73e0\u6c5f\u53e3\u3001\u6d77\u9632\u6e2f\u53e3\u548c\u5317\u90e8\u6e7e\u6e14\u573a\u957f\u671f\u53c2\u4e0e\u534e\u5357\u4e0e\u4e1c\u5357\u4e9a\u6cbf\u6d77\u4ea4\u6613\u3002"],
        ["\u5317\u6d77\u3001\u6d77\u53e3\u3001\u6d77\u9632\u548c\u4e07\u5b89\u7b49\u6cbf\u6d77\u6e2f\u53e3\u8fde\u63a5\u6e14\u4e1a\u3001\u6e2f\u53e3\u7269\u6d41\u4e0e\u6d77\u5cb8\u793e\u533a\u3002"],
        ["\u5317\u90e8\u6e7e\u6e2f\u53e3\u7f51\u7edc\u8fde\u63a5\u73e0\u6c5f\u53e3\u3001\u7ea2\u6cb3\u53e3\u548c\u5357\u6d77\u5317\u90e8\u822a\u7ebf\u3002"],
        ["\u9ec4\u9c7c\u3001\u5e26\u9c7c\u3001\u4e4c\u8d3c\u3001\u867e\u3001\u751f\u869d\u548c\u7ea2\u6811\u6797\u87f9\u662f\u6e7e\u5185\u5e38\u89c1\u7684\u6e14\u4e1a\u7c7b\u522b\u3002"],
        ["\u6cb3\u53e3\u6e7f\u5730\u3001\u6d77\u6e7e\u6e14\u6751\u548c\u6c34\u4ea7\u5e02\u573a\u5f62\u6210\u5317\u90e8\u6e7e\u6cbf\u5cb8\u751f\u6d3b\u7f51\u7edc\u3002"],
        ["\u5317\u90e8\u6e7e", "\u73e0\u6c5f\u53e3", "\u7ea2\u6cb3\u53e3"], ["\u5317\u90e8\u6e7e", "Gulf of Tonkin"],
    ),
    "Taiwan Strait": _profile(
        "\u4e2d\u56fd\u53f0\u6e7e\u6d77\u5ce1\u8fde\u63a5\u4e1c\u6d77\u4e0e\u5357\u6d77\uff0c\u662f\u9646\u67b6\u6d77\u3001\u6f6e\u6d41\u548c\u5b63\u98ce\u4ea4\u6362\u5f3a\u70c8\u7684\u6d77\u57df\uff0c\u6d77\u5ce1\u4e24\u4fa7\u5206\u5e03\u591a\u4e2a\u5927\u578b\u6e2f\u53e3\u3002",
        ["\u798f\u5efa\u6cbf\u5cb8\u4e0e\u4e2d\u56fd\u53f0\u6e7e\u6cbf\u5cb8\u957f\u671f\u4ee5\u6e14\u4e1a\u3001\u6d77\u8fd0\u548c\u5c9b\u5c7f\u8d38\u6613\u4fdd\u6301\u5f80\u6765\u3002"],
        ["\u53a6\u95e8\u3001\u798f\u5dde\u3001\u6cc9\u5dde\u3001\u57fa\u9686\u548c\u9ad8\u96c4\u7b49\u6e2f\u53e3\u8fde\u63a5\u6d77\u5ce1\u4e24\u5cb8\u7684\u6e14\u6e2f\u3001\u5de5\u4e1a\u4e0e\u6d77\u5cb8\u793e\u533a\u3002"],
        ["\u6d77\u5ce1\u662f\u4e1c\u6d77\u81f3\u5357\u6d77\u7684\u8fd1\u6d77\u822a\u8def\u901a\u9053\uff0c\u5b63\u98ce\u4f1a\u6539\u53d8\u6f6e\u6d41\u4e0e\u6c34\u4f53\u4ea4\u6362\u3002"],
        ["\u5e26\u9c7c\u3001\u5c0f\u9ec4\u9c7c\u3001\u4e4c\u8d3c\u3001\u9cb3\u9c7c\u3001\u867e\u548c\u751f\u869d\u662f\u6d77\u5ce1\u4e24\u4fa7\u6709\u957f\u671f\u8bb0\u5f55\u7684\u6e14\u4e1a\u5bf9\u8c61\u3002"],
        ["\u6d77\u5ce1\u6e14\u6e2f\u3001\u5988\u7956\u4fe1\u4ef0\u4e0e\u6cbf\u5cb8\u8239\u961f\u6784\u6210\u5177\u4f53\u7684\u6d77\u5ce1\u4eba\u6587\u666f\u89c2\u3002"],
        ["\u4e2d\u56fd\u53f0\u6e7e\u6d77\u5ce1", "\u5e26\u9c7c", "\u5c0f\u9ec4\u9c7c"], ["\u4e2d\u56fd\u53f0\u6e7e\u6d77\u5ce1", "Taiwan Strait"],
    ),
    "Luzon Strait": _profile(
        "\u5415\u5b8b\u6d77\u5ce1\u4f4d\u4e8e\u4e2d\u56fd\u53f0\u6e7e\u4e0e\u5415\u5b8b\u5c9b\u4e4b\u95f4\uff0c\u5df4\u58eb\u6d77\u5ce1\u662f\u897f\u5317\u592a\u5e73\u6d0b\u6696\u6c34\u5411\u5357\u4f20\u8f93\u7684\u91cd\u8981\u901a\u9053\u3002",
        ["\u5415\u5b8b\u6d77\u5ce1\u7684\u5c9b\u5c7f\u822a\u6d77\u4e0e\u53f0\u98ce\u8def\u5f84\u4e00\u76f4\u662f\u6d77\u6d0b\u793e\u4f1a\u7684\u91cd\u8981\u7ecf\u9a8c\u3002"],
        ["\u4e2d\u56fd\u53f0\u6e7e\u4e1c\u5357\u6e2f\u53e3\u3001\u5df4\u6797\u5858\u7fa4\u5c9b\u548c\u5415\u5b8b\u5317\u90e8\u6e14\u6751\u4f9d\u8d56\u6d77\u5ce1\u6f6e\u6d41\u4e0e\u8fd1\u6d77\u8d44\u6e90\u3002"],
        ["\u5df4\u58eb\u6d77\u5ce1\u4e0e\u5df4\u6797\u5858\u6c34\u9053\u6784\u6210\u4e1c\u4e9a\u81f3\u897f\u592a\u5e73\u6d0b\u7684\u822a\u8fd0\u4e0e\u6d0b\u6d41\u901a\u9053\u3002"],
        ["\u98de\u9c7c\u3001\u91d1\u67aa\u9c7c\u3001\u9c90\u9c7c\u3001\u4e4c\u8d3c\u548c\u6df1\u6d77\u867e\u662f\u8be5\u6d77\u5ce1\u5468\u8fb9\u6e14\u4e1a\u4e0e\u79d1\u7814\u89c2\u6d4b\u5bf9\u8c61\u3002"],
        ["\u5c9b\u5c7f\u6e14\u6751\u4e0e\u53f0\u98ce\u822a\u6d77\u7ecf\u9a8c\u6784\u6210\u5415\u5b8b\u6d77\u5ce1\u7684\u4eba\u6587\u8bb0\u5fc6\u3002"],
        ["\u5415\u5b8b\u6d77\u5ce1", "\u5df4\u58eb\u6d77\u5ce1", "\u9ed1\u6f6e"], ["\u5415\u5b8b\u6d77\u5ce1", "Luzon Strait"],
    ),
    "Bay of Bengal": _profile(
        "\u5b5f\u52a0\u62c9\u6e7e\u662f\u5370\u5ea6\u6d0b\u4e1c\u5317\u90e8\u7684\u5927\u6d77\u6e7e\uff0c\u6052\u6cb3\u3001\u5e03\u62c9\u9a6c\u666e\u7279\u62c9\u6cb3\u4e0e\u4f0a\u6d1b\u74e6\u5e95\u6c5f\u7ed9\u6e7e\u9876\u5e26\u6765\u5927\u91cf\u6de1\u6c34\u548c\u6ce5\u6c99\u3002",
        ["\u5b5f\u52a0\u62c9\u6e7e\u662f\u5370\u5ea6\u3001\u5b5f\u52a0\u62c9\u56fd\u3001\u7f05\u7538\u548c\u65af\u91cc\u5170\u5361\u6cbf\u6d77\u8d38\u6613\u4e0e\u6e14\u4e1a\u7684\u4f20\u7edf\u7a7a\u95f4\u3002"],
        ["\u6052\u6cb3\u4e09\u89d2\u6d32\u3001\u6851\u5fb7\u5c14\u6e7e\u548c\u7f57\u5fb7\u6d77\u5cb8\u793e\u533a\u540c\u65f6\u4f9d\u8d56\u6e7f\u5730\u4fdd\u62a4\u3001\u822a\u8fd0\u548c\u6e14\u4e1a\u3002"],
        ["\u5b63\u98ce\u6539\u53d8\u5b5f\u52a0\u62c9\u6e7e\u7684\u8868\u5c42\u6d0b\u6d41\uff0c\u65af\u91cc\u5170\u5361\u4e0e\u9a6c\u516d\u7532\u6d77\u5ce1\u662f\u91cd\u8981\u822a\u8fd0\u901a\u9053\u3002"],
        ["\u6052\u6cb3\u9ca5\u9c7c\u3001\u6d77\u867e\u3001\u6ce5\u87f9\u3001\u9c7c\u7c7b\u548c\u8fd1\u6d77\u867e\u7c7b\u662f\u5b5f\u52a0\u62c9\u6e7e\u6cbf\u5cb8\u7684\u4e3b\u8981\u6e14\u4e1a\u5bf9\u8c61\u3002"],
        ["\u6851\u5fb7\u5c14\u5c9b\u7ea2\u6811\u6797\u3001\u6cb3\u53e3\u6e7f\u5730\u4e0e\u4f20\u7edf\u6e14\u6751\u662f\u6e7e\u6cbf\u5cb8\u6587\u5316\u7684\u6807\u5fd7\u3002"],
        ["\u5b5f\u52a0\u62c9\u6e7e", "\u6052\u6cb3\u4e09\u89d2\u6d32", "\u6851\u5fb7\u5c14\u6e7e"], ["\u5b5f\u52a0\u62c9\u6e7e", "Bay of Bengal"],
    ),
    "Arabian Sea": _profile(
        "\u963f\u62c9\u4f2f\u6d77\u4f4d\u4e8e\u5370\u5ea6\u6d0b\u897f\u5317\u90e8\uff0c\u5370\u5ea6\u897f\u5cb8\u3001\u5df4\u57fa\u65af\u5766\u548c\u963f\u66fc\u6cbf\u5cb8\u7684\u5b63\u98ce\u5f3a\u5316\u4f1a\u5f15\u53d1\u6cbf\u5cb8\u4e0a\u5347\u6d41\u4e0e\u9ad8\u751f\u4ea7\u529b\u3002",
        ["\u963f\u62c9\u4f2f\u6d77\u957f\u671f\u662f\u4e1c\u975e\u3001\u963f\u62c9\u4f2f\u534a\u5c9b\u3001\u5357\u4e9a\u4e0e\u4e1c\u5357\u4e9a\u6e2f\u53e3\u7684\u5b63\u98ce\u822a\u6d77\u8d70\u5eca\u3002"],
        ["\u963f\u66fc\u3001\u4f0a\u6717\u6e7e\u3001\u5df4\u57fa\u65af\u5766\u6cbf\u5cb8\u6e2f\u53e3\u4e0e\u5370\u5ea6\u897f\u5cb8\u6e14\u6751\u5171\u540c\u4f7f\u7528\u963f\u62c9\u4f2f\u6d77\u8d44\u6e90\u3002"],
        ["\u963f\u62c9\u4f2f\u6d77\u8fde\u63a5\u963f\u66fc\u6e7e\u3001\u4f0a\u6717\u6e7e\u4e0e\u963f\u4f0a\u6d77\u4e4b\u95f4\u7684\u80fd\u6e90\u548c\u96c6\u88c5\u7bb1\u822a\u7ebf\u3002"],
        ["\u6c99\u4e01\u9c7c\u3001\u91d1\u67aa\u9c7c\u3001\u9ec4\u9c7c\u3001\u867e\u3001\u9f99\u867e\u548c\u91d1\u67aa\u9c7c\u662f\u8be5\u6d77\u57df\u6e14\u4e1a\u4e0e\u8c03\u67e5\u7684\u5e38\u89c1\u5bf9\u8c61\u3002"],
        ["\u6cbf\u5cb8\u6e14\u6751\u3001\u963f\u62c9\u4f2f\u6d77\u822a\u6d77\u4f20\u7edf\u548c\u5b63\u98ce\u77e5\u8bc6\u6784\u6210\u6d77\u5cb8\u6587\u5316\u8bb0\u5fc6\u3002"],
        ["\u963f\u62c9\u4f2f\u6d77", "\u5b63\u98ce\u4e0a\u5347\u6d41", "\u963f\u66fc\u6e7e"], ["\u963f\u62c9\u4f2f\u6d77", "Arabian Sea"],
    ),
    "Sea of Japan": _profile(
        "\u65e5\u672c\u6d77\u662f\u897f\u5317\u592a\u5e73\u6d0b\u8fb9\u7f18\u6d77\uff0c\u5bf9\u9a6c\u6d77\u5ce1\u3001\u5b97\u8c37\u6d77\u5ce1\u548c\u6d25\u8f7b\u6d77\u5ce1\u8fde\u63a5\u65e5\u672c\u6d77\u4e0e\u5468\u8fb9\u6d77\u57df\u3002",
        ["\u671d\u9c9c\u534a\u5c9b\u3001\u65e5\u672c\u897f\u5cb8\u548c\u4fc4\u7f57\u65af\u8fdc\u4e1c\u6e2f\u53e3\u957f\u671f\u53c2\u4e0e\u65e5\u672c\u6d77\u6e14\u4e1a\u4e0e\u6d77\u8fd0\u3002"],
        ["\u91dc\u5c71\u3001\u65b0\u6f5f\u3001\u4f0f\u5c14\u52a0\u6e2f\u548c\u4f50\u4e16\u4fdd\u7b49\u6e2f\u53e3\u8fde\u63a5\u6d77\u5ce1\u5468\u8fb9\u6e14\u4e1a\u548c\u5de5\u4e1a\u793e\u533a\u3002"],
        ["\u5bf9\u9a6c\u6d77\u5ce1\u548c\u6d25\u8f7b\u6d77\u5ce1\u662f\u4e1c\u4e9a\u6d77\u8fd0\u4e0e\u6d0b\u6d41\u4ea4\u6362\u7684\u5173\u952e\u901a\u9053\u3002"],
        ["\u4fc4\u7f57\u65af\u6d77\u57df\u9c7c\u3001\u660e\u592a\u9c7c\u3001\u5e26\u9c7c\u3001\u4e4c\u8d3c\u3001\u96ea\u87f9\u548c\u6d77\u80c6\u662f\u65e5\u672c\u6d77\u5468\u8fb9\u7684\u6e14\u4e1a\u5bf9\u8c61\u3002"],
        ["\u65e5\u672c\u6d77\u6cbf\u5cb8\u6e14\u6e2f\u3001\u5c9b\u5c7f\u793e\u533a\u548c\u5b63\u8282\u6027\u9c7c\u5e02\u6784\u6210\u6d77\u5cb8\u751f\u6d3b\u666f\u89c2\u3002"],
        ["\u65e5\u672c\u6d77", "\u5bf9\u9a6c\u6d77\u5ce1", "\u6d25\u8f7b\u6d77\u5ce1"], ["\u65e5\u672c\u6d77", "Sea of Japan"],
    ),
    "Caribbean Sea": _profile(
        "\u52a0\u52d2\u6bd4\u6d77\u662f\u5927\u897f\u6d0b\u897f\u90e8\u7684\u70ed\u5e26\u6d77\uff0c\u7531\u5c24\u5361\u5766\u6d77\u5ce1\u3001\u5df4\u62ff\u9a6c\u8fd0\u6cb3\u548c\u5411\u98ce\u6d77\u5ce1\u4e0e\u5927\u897f\u6d0b\u4e92\u901a\u3002",
        ["\u52a0\u52d2\u6bd4\u6d77\u5c9b\u5c7f\u662f\u6b27\u6d32\u3001\u975e\u6d32\u548c\u7f8e\u6d32\u6d77\u4e0a\u8d38\u6613\u4e0e\u79fb\u6c11\u53f2\u7684\u91cd\u8981\u7a7a\u95f4\u3002"],
        ["\u53e4\u5df4\u3001\u591a\u7c73\u5c3c\u52a0\u3001\u6d77\u5730\u548c\u5df4\u4f2f\u591a\u65af\u7684\u6e14\u6751\u3001\u6e2f\u53e3\u4e0e\u73ca\u745a\u793e\u533a\u7d27\u5bc6\u76f8\u8fde\u3002"],
        ["\u5df4\u62ff\u9a6c\u8fd0\u6cb3\u4e0e\u5c24\u5361\u5766\u6d77\u5ce1\u662f\u52a0\u52d2\u6bd4\u6d77\u4e0e\u5927\u897f\u6d0b\u3001\u592a\u5e73\u6d0b\u7684\u91cd\u8981\u6c34\u9053\u3002"],
        ["\u9f99\u867e\u3001\u5973\u738b\u87ba\u3001\u7ea2\u9c7c\u3001\u9c82\u9c7c\u3001\u867e\u548c\u73ca\u745a\u7901\u6e14\u4e1a\u662f\u52a0\u52d2\u6bd4\u6d77\u7684\u5177\u4f53\u8d44\u6e90\u7c7b\u578b\u3002"],
        ["\u5c9b\u5c7f\u6e14\u6751\u3001\u73ca\u745a\u7901\u4fdd\u62a4\u533a\u548c\u6e2f\u53e3\u6587\u5316\u5171\u540c\u6784\u6210\u52a0\u52d2\u6bd4\u6d77\u6cbf\u5cb8\u666f\u89c2\u3002"],
        ["\u52a0\u52d2\u6bd4\u6d77", "\u9f99\u867e", "\u73ca\u745a\u7901"], ["\u52a0\u52d2\u6bd4\u6d77", "Caribbean Sea"],
    ),
    "Bering Sea": _profile(
        "\u767d\u4ee4\u6d77\u662f\u5317\u592a\u5e73\u6d0b\u4e0e\u5317\u51b0\u6d0b\u4e4b\u95f4\u7684\u9646\u67b6\u6d77\uff0c\u6d45\u5e7f\u9646\u67b6\u3001\u6d77\u51b0\u548c\u963f\u7559\u7533\u7fa4\u5c9b\u5f71\u54cd\u5176\u751f\u4ea7\u529b\u4e0e\u822a\u884c\u3002",
        ["\u963f\u7559\u7533\u7fa4\u5c9b\u548c\u767d\u4ee4\u6d77\u6cbf\u5cb8\u539f\u4f4f\u6c11\u957f\u671f\u4ee5\u6d77\u6d0b\u6e14\u730e\u4e0e\u5b63\u8282\u6027\u6d77\u51b0\u77e5\u8bc6\u4e3a\u751f\u3002"],
        ["\u963f\u6d25\u3001\u8bfa\u59c6\u548c\u963f\u7559\u7533\u6e2f\u53e3\u4e3a\u5f00\u653e\u6d77\u6d0b\u79d1\u7814\u3001\u6e14\u4e1a\u548c\u8865\u7ed9\u7684\u8282\u70b9\u3002"],
        ["\u767d\u4ee4\u6d77\u822a\u8fd0\u53d7\u6d77\u51b0\u4e0e\u6c14\u8c61\u9650\u5236\uff0c\u963f\u7559\u7533\u6d77\u5ce1\u662f\u5357\u5317\u6d0b\u6d41\u4ea4\u6362\u901a\u9053\u3002"],
        ["\u963f\u62c9\u65af\u52a0\u5e95\u9c7c\u3001\u5317\u592a\u5e73\u6d0b\u5455\u9c7c\u3001\u96ea\u87f9\u3001\u5e1d\u738b\u87f9\u3001\u4e09\u6587\u9c7c\u548c\u5927\u9ebb\u54c8\u9c7c\u662f\u767d\u4ee4\u6d77\u7684\u5177\u4f53\u6e14\u4e1a\u5bf9\u8c61\u3002"],
        ["\u6cbf\u5cb8\u539f\u4f4f\u6c11\u793e\u533a\u3001\u6e14\u8239\u57fa\u5730\u548c\u6d77\u51b0\u89c2\u6d4b\u7ad9\u6784\u6210\u767d\u4ee4\u6d77\u7684\u4eba\u6d77\u5173\u7cfb\u3002"],
        ["\u767d\u4ee4\u6d77", "\u963f\u7559\u7533\u6d77\u5ce1", "\u5317\u592a\u5e73\u6d0b\u9c7c\u7c7b"], ["\u767d\u4ee4\u6d77", "Bering Sea"],
    ),
})


# Complete the offline atlas for the named regions used by the fallback
# gazetteer and by common Marine Regions records.  Every entry intentionally
# carries the same seven sections so a click never falls back to a blank card.
REGIONAL_PROFILES.update({
    "Tasman Sea": _profile(
        "\u5854\u65af\u66fc\u6d77\u4f4d\u4e8e\u6fb3\u5927\u5229\u4e9a\u4e1c\u5357\u5cb8\u4e0e\u65b0\u897f\u5170\u4e4b\u95f4\uff0c\u662f\u5357\u592a\u5e73\u6d0b\u897f\u90e8\u7684\u5e7f\u9614\u6d77\u57df\u3002",
        ["\u6fb3\u6d32\u4e0e\u65b0\u897f\u5170\u4e4b\u95f4\u7684\u5c9b\u9645\u822a\u6d77\u548c\u79fb\u6c11\u822a\u7ebf\u5f62\u6210\u4e86\u5854\u65af\u66fc\u6d77\u7684\u8fd1\u4ee3\u5386\u53f2\u8bb0\u5fc6\u3002", "\u6e14\u4e1a\u8c03\u67e5\u4e0e\u6d77\u6d0b\u79d1\u7814\u662f\u533a\u57df\u957f\u671f\u822a\u6d77\u7684\u91cd\u8981\u7528\u9014\u3002"],
        ["\u6089\u5c3c\u3001\u970d\u5df4\u7279\u3001\u58a8\u5c14\u672c\u548c\u5965\u514b\u5170\u7684\u6e2f\u53e3\u4e0e\u6d77\u5cb8\u793e\u533a\u901a\u8fc7\u4e1c\u5357\u6d77\u57df\u8fde\u63a5\u3002", "\u6e2f\u53e3\u548c\u5c9b\u5c7f\u793e\u533a\u540c\u65f6\u53d7\u6d77\u6d0b\u98ce\u6d6a\u3001\u6c14\u65cb\u4e0e\u5b63\u8282\u6027\u6d0b\u6d41\u5f71\u54cd\u3002"],
        ["\u6fb3\u5927\u5229\u4e9a\u4e1c\u5357\u5cb8\u81f3\u65b0\u897f\u5170\u7684\u8fdc\u6d0b\u822a\u7ebf\u7ecf\u8fc7\u5854\u65af\u66fc\u6d77\u897f\u90e8\u3002", "\u6d77\u5ce1\u548c\u6d0b\u6d41\u6761\u4ef6\u4f1a\u6539\u53d8\u8fdc\u6d0b\u8239\u53ea\u7684\u7ecf\u5178\u822a\u7ebf\u3002"],
        ["\u65b0\u897f\u5170\u6d6a\u6f2b\u9c7c\u3001\u5357\u65b9\u84dd\u9c7c\u3001\u5927\u6d0b\u9c7c\u3001\u5ca9\u9f99\u867e\u548c\u9c81\u9c7c\u662f\u53ef\u5728\u6e14\u4e1a\u540d\u5f55\u4e2d\u627e\u5230\u7684\u5177\u4f53\u7269\u79cd\u3002", "\u6cbf\u5cb8\u6e14\u6e2f\u540c\u65f6\u5f00\u5c55\u9f99\u867e\u3001\u8d1d\u7c7b\u548c\u6e29\u5e26\u9c7c\u7c7b\u8c03\u67e5\u3002"],
        ["\u6d77\u5c9b\u822a\u6d77\u3001\u6e14\u6e2f\u98df\u7269\u6587\u5316\u548c\u65b0\u897f\u5170\u6bdb\u5229\u4f20\u7edf\u5171\u540c\u6784\u6210\u5854\u65af\u66fc\u6d77\u7684\u4eba\u6587\u666f\u89c2\u3002"],
        ["\u5854\u65af\u66fc\u6d77", "\u5357\u592a\u5e73\u6d0b\u897f\u90e8", "\u6e29\u5e26\u6e14\u4e1a"], ["\u5854\u65af\u66fc\u6d77", "Tasman Sea"],
    ),
    "North Sea": _profile(
        "\u5317\u6d77\u662f\u6b27\u6d32\u897f\u5317\u90e8\u7684\u6d45\u6d77\uff0c\u4e0e\u82f1\u5409\u6d77\u5ce1\u3001\u632a\u5a01\u6d77\u548c\u6ce2\u7f57\u7684\u6d77\u76f8\u8fde\u3002",
        ["\u5317\u6d77\u662f\u4e2d\u4e16\u7eaa\u4ee5\u6765\u5317\u6b27\u3001\u897f\u6b27\u6e2f\u53e3\u8d38\u6613\u4e0e\u6e14\u4e1a\u8054\u7edc\u7684\u6838\u5fc3\u6d77\u57df\u3002", "\u7eff\u8272\u80fd\u6e90\u3001\u6cb9\u6c14\u4e0e\u6e14\u4e1a\u8d44\u6e90\u5171\u540c\u5851\u9020\u4e86\u8fd1\u4ee3\u6cbf\u5cb8\u7ecf\u6d4e\u3002"],
        ["\u82f1\u56fd\u4e1c\u5cb8\u3001\u632a\u5a01\u3001\u4e39\u9ea6\u3001\u8377\u5170\u548c\u6bd4\u5229\u65f6\u6e2f\u53e3\u7ec4\u6210\u7d27\u5bc6\u7684\u6d77\u5cb8\u57ce\u5e02\u5e26\u3002", "\u6d45\u6d77\u6ee9\u6d82\u3001\u6cb3\u53e3\u6e7f\u5730\u4e0e\u6d77\u4e0a\u98ce\u7535\u5e76\u5b58\u4e8e\u6d77\u6cbf\u3002"],
        ["\u82f1\u5409\u6d77\u5ce1\u3001\u65af\u5361\u683c\u62c9\u514b\u6d77\u5ce1\u4e0e\u6ce2\u7f57\u7684\u6d77\u51fa\u53e3\u6784\u6210\u5317\u6d77\u6e2f\u53e3\u7f51\u7edc\u3002", "\u5317\u6d77\u822a\u8fd0\u53d7\u98ce\u6d6a\u3001\u6d45\u6c34\u548c\u6f6e\u6c50\u7ea6\u675f\u3002"],
        ["\u9cb1\u9c7c\u3001\u9cd5\u9c7c\u3001\u9ec4\u76d6\u9c7c\u3001\u6bd4\u76ee\u9c7c\u3001\u9c3d\u9c7c\u548c\u6b27\u6d32\u9f99\u867e\u662f\u5317\u6d77\u6e14\u4e1a\u4e2d\u7684\u5177\u4f53\u7269\u79cd\u3002", "\u6ce5\u6ee9\u8d1d\u7c7b\u4e0e\u7261\u86ce\u517b\u6b96\u4e5f\u662f\u6cbf\u5cb8\u6d77\u6d0b\u7ecf\u6d4e\u7684\u91cd\u8981\u90e8\u5206\u3002"],
        ["\u6e14\u6e2f\u3001\u6f01\u592b\u4f20\u7edf\u548c\u6d77\u4e0a\u98ce\u7535\u666f\u89c2\u662f\u5317\u6d77\u6cbf\u5cb8\u6587\u5316\u7684\u53ef\u89c1\u8f7d\u4f53\u3002"],
        ["\u5317\u6d77", "\u591a\u683c\u94f6\u884c", "\u6d77\u4e0a\u98ce\u7535"], ["\u5317\u6d77", "North Sea"],
    ),
    "Norwegian Sea": _profile(
        "\u632a\u5a01\u6d77\u4f4d\u4e8e\u5317\u5927\u897f\u6d0b\u4e0e\u5317\u51b0\u6d0b\u8fc7\u6e21\u5e26\uff0c\u632a\u5a01\u6d0b\u6d41\u4e0e\u6d77\u51b0\u5171\u540c\u5f71\u54cd\u5176\u73af\u5883\u3002",
        ["\u632a\u5a01\u6d77\u6cbf\u5cb8\u6e14\u4e1a\u3001\u8fdc\u6d0b\u822a\u6d77\u4e0e\u5317\u6781\u79d1\u7814\u5f62\u6210\u4e86\u957f\u671f\u6d77\u6d0b\u8bb0\u5f55\u3002"],
        ["\u632a\u5a01\u6cbf\u5cb8\u3001\u82cf\u683c\u5170\u7fa4\u5c9b\u548c\u51b0\u5c9b\u4e4b\u95f4\u7684\u6e2f\u53e3\u4f9d\u8d56\u6e14\u4e1a\u3001\u6d77\u6d0b\u80fd\u6e90\u4e0e\u8865\u7ed9\u3002"],
        ["\u632a\u5a01\u6d77\u662f\u5317\u5927\u897f\u6d0b\u81f3\u5317\u51b0\u6d0b\u7684\u6df1\u6c34\u822a\u8def\uff0c\u5b63\u8282\u6027\u51b0\u7f18\u5f71\u54cd\u822a\u7ebf\u3002"],
        ["\u5927\u897f\u6d0b\u9ca1\u3001\u5927\u897f\u6d0b\u9c7c\u3001\u9ca4\u9c7c\u3001\u9cb1\u9c7c\u3001\u9c7d\u9c7c\u548c\u5317\u6781\u867e\u662f\u8be5\u533a\u57df\u6709\u5177\u4f53\u540d\u5f55\u7684\u7269\u79cd\u3002"],
        ["\u6d77\u51b0\u8fb9\u7f18\u3001\u5317\u6781\u5149\u4e0e\u6e14\u6e2f\u6587\u5316\u6784\u6210\u632a\u5a01\u6d77\u7684\u72ec\u7279\u4eba\u6587\u80cc\u666f\u3002"],
        ["\u632a\u5a01\u6d77", "\u632a\u5a01\u6d0b\u6d41", "\u51b0\u7f18", "\u5317\u6781\u867e"], ["\u632a\u5a01\u6d77", "Norwegian Sea"],
    ),
    "Arctic Ocean": _profile(
        "\u5317\u51b0\u6d0b\u662f\u5730\u7403\u6700\u5317\u7684\u6d0b\u533a\uff0c\u6d77\u51b0\u3001\u9646\u67b6\u6d45\u6d77\u548c\u5b63\u8282\u6027\u5149\u7167\u51b3\u5b9a\u5176\u751f\u6001\u4e0e\u822a\u8fd0\u6761\u4ef6\u3002",
        ["\u5317\u6781\u6cbf\u5cb8\u793e\u533a\u7684\u822a\u884c\u3001\u72e9\u730e\u548c\u6e14\u4e1a\u77e5\u8bc6\u5728\u957f\u671f\u6d77\u51b0\u89c2\u5bdf\u4e2d\u5f62\u6210\u3002"],
        ["\u5317\u6781\u6751\u843d\u3001\u79d1\u8003\u7ad9\u548c\u6e2f\u53e3\u8865\u7ed9\u70b9\u662f\u8be5\u6d77\u57df\u4e3b\u8981\u4eba\u7c7b\u8282\u70b9\u3002"],
        ["\u5317\u6781\u822a\u9053\u7684\u53ef\u822a\u671f\u3001\u51b0\u7f18\u4f4d\u7f6e\u548c\u6c14\u8c61\u7a97\u53e3\u9700\u540c\u65f6\u6838\u5bf9\u3002"],
        ["FAO ASFIS 2026-1 \u6536\u5f55\u5317\u6781\u9cd5\uff08Boreogadus saida\uff09\u3001\u6bdb\u9cde\u9c7c\uff08Mallotus villosus\uff09\u3001\u5317\u65b9\u957f\u989d\u867e\uff08Pandalus borealis\uff09\u3001\u683c\u9675\u5170\u5927\u6bd4\u76ee\u9c7c\uff08Reinhardtius hippoglossoides\uff09\u548c\u73af\u6591\u6d77\u8c79\uff08Pusa hispida\uff09\uff1b\u8fd9\u4e9b\u662f\u540d\u5f55\u9879\uff0c\u4e0d\u4ee3\u8868\u5f53\u524d\u5750\u6807\u5df2\u89c2\u6d4b\u5230\u3002"],
        ["\u5317\u6781\u539f\u4f4f\u6c11\u6d77\u6d0b\u77e5\u8bc6\u3001\u6d77\u51b0\u4f20\u7edf\u548c\u6781\u5730\u79d1\u7814\u662f\u91cd\u8981\u6587\u5316\u4e3b\u9898\u3002"],
        ["\u5317\u51b0\u6d0b", "\u5317\u6781\u822a\u9053", "\u6d77\u51b0", "\u6781\u5730\u6d0b\u6d41"], ["\u5317\u51b0\u6d0b", "Arctic Ocean"],
    ),
    "Southern Ocean": _profile(
        "\u5357\u5927\u6d0b\u73af\u7ed5\u5357\u6781\u6d32\uff0c\u5357\u6781\u73af\u6d41\u5c06\u5927\u897f\u6d0b\u3001\u5370\u5ea6\u6d0b\u548c\u592a\u5e73\u6d0b\u7684\u6df1\u6c34\u4e0e\u8868\u5c42\u8fde\u63a5\u8d77\u6765\u3002",
        ["\u5357\u6781\u822a\u6d77\u3001\u79d1\u8003\u548c\u56fd\u9645\u4fdd\u62a4\u8ba9\u5357\u5927\u6d0b\u5f62\u6210\u8de8\u56fd\u5408\u4f5c\u5386\u53f2\u3002"],
        ["\u6ca1\u6709\u5e38\u4f4f\u6cbf\u5cb8\u57ce\u5e02\uff0c\u79d1\u8003\u7ad9\u3001\u8865\u7ed9\u8239\u548c\u8fdc\u6d0b\u8239\u961f\u662f\u4e3b\u8981\u4eba\u7c7b\u8282\u70b9\u3002"],
        ["\u5357\u6781\u73af\u6d41\u3001\u5fb7\u96f7\u514b\u6d77\u5ce1\u548c\u5357\u6781\u534a\u5c9b\u8865\u7ed9\u8def\u7ebf\u662f\u79d1\u8003\u822a\u884c\u7684\u5173\u952e\u53c2\u8003\u3002"],
        ["\u5357\u6781\u78f7\u867e\u3001\u5357\u6781\u9f7f\u9c7c\u3001\u5357\u6781\u51b0\u9c7c\u3001\u5357\u6781\u4e91\u9e20\u548c\u6d77\u8c79\u662f\u8be5\u533a\u57df\u6709\u5177\u4f53\u540d\u5f55\u7684\u5bf9\u8c61\u3002"],
        ["\u6781\u5730\u79d1\u8003\u7ad9\u3001\u73af\u6d41\u89c2\u6d4b\u548c\u5357\u6781\u4fdd\u62a4\u8bae\u9898\u6784\u6210\u5357\u5927\u6d0b\u7684\u73b0\u4ee3\u4eba\u6587\u8bb0\u5fc6\u3002"],
        ["\u5357\u5927\u6d0b", "\u5357\u6781\u73af\u6d41", "\u78f7\u867e", "\u5357\u6781\u79d1\u8003"], ["\u5357\u5927\u6d0b", "Southern Ocean"],
    ),
    "Pacific Ocean": _profile(
        "\u592a\u5e73\u6d0b\u662f\u5730\u7403\u9762\u79ef\u6700\u5927\u7684\u6d0b\u533a\uff0c\u4ece\u897f\u592a\u5e73\u6d0b\u5c9b\u94fe\u5230\u4e1c\u592a\u5e73\u6d0b\u6d77\u5c71\u7684\u73af\u6d41\u548c\u6d77\u6c9f\u4e0d\u540c\u3002",
        ["\u592a\u5e73\u6d0b\u5c9b\u5c7f\u822a\u6d77\u3001\u4e1c\u4e9a\u6e2f\u53e3\u8d38\u6613\u548c\u8de8\u6d0b\u822a\u7ebf\u6784\u6210\u4e86\u957f\u671f\u4eba\u7c7b\u8054\u7cfb\u3002"],
        ["\u4e1c\u4e9a\u3001\u5927\u6d0b\u6d32\u4e0e\u7f8e\u6d32\u7684\u6e2f\u53e3\u3001\u5c9b\u5c7f\u793e\u533a\u548c\u8fdc\u6d0b\u79d1\u8003\u7ad9\u5206\u5e03\u5e7f\u6cdb\u3002"],
        ["\u4e1c\u897f\u5411\u8de8\u592a\u5e73\u6d0b\u822a\u7ebf\u4e0e\u9a6c\u516d\u7532\u3001\u5df4\u62ff\u9a6c\u548c\u9a6c\u516d\u7532\u6d77\u5ce1\u4ea4\u6362\u901a\u9053\u76f8\u8fde\u3002"],
        ["\u91d1\u67aa\u9c7c\u3001\u9ec4\u9ccd\u9c7c\u3001\u5927\u773c\u91d1\u67aa\u9c7c\u3001\u9c50\u9c7c\u3001\u9c81\u9c7c\u3001\u6df1\u6d77\u9c7c\u7c7b\u548c\u6d77\u867e\u662f\u591a\u4e2a\u592a\u5e73\u6d0b\u6e14\u533a\u7684\u5177\u4f53\u8d44\u6e90\u3002"],
        ["\u5c9b\u5c7f\u822a\u6d77\u4f20\u7edf\u3001\u6d77\u6d0b\u98df\u7269\u6587\u5316\u548c\u6d77\u6d0b\u4fdd\u62a4\u533a\u662f\u592a\u5e73\u6d0b\u4eba\u6587\u7684\u4e0d\u540c\u8f7d\u4f53\u3002"],
        ["\u592a\u5e73\u6d0b", "\u8de8\u592a\u5e73\u6d0b\u822a\u7ebf", "\u9a6c\u516d\u7532\u6d77\u5ce1", "\u91d1\u67aa\u9c7c"], ["\u592a\u5e73\u6d0b", "Pacific Ocean"],
    ),
    "Atlantic Ocean": _profile(
        "\u5927\u897f\u6d0b\u4f4d\u4e8e\u6b27\u6d32\u3001\u975e\u6d32\u4e0e\u7f8e\u6d32\u4e4b\u95f4\uff0c\u5317\u5927\u897f\u6d0b\u4e0e\u5357\u5927\u897f\u6d0b\u901a\u8fc7\u73af\u6d41\u7cfb\u7edf\u76f8\u8fde\u3002",
        ["\u5927\u897f\u6d0b\u822a\u8def\u4e0e\u6b27\u975e\u7f8e\u4e4b\u95f4\u7684\u8d38\u6613\u3001\u79fb\u6c11\u548c\u79d1\u5b66\u4ea4\u6d41\u5bc6\u5207\u76f8\u5173\u3002"],
        ["\u5317\u7f8e\u3001\u6b27\u6d32\u897f\u5cb8\u548c\u897f\u975e\u6cbf\u5cb8\u6e2f\u53e3\u901a\u8fc7\u5927\u897f\u6d0b\u822a\u7ebf\u8fde\u63a5\u3002"],
        ["\u5317\u5927\u897f\u6d0b\u822a\u7ebf\u3001\u51e0\u5185\u4e9a\u6d77\u6e7e\u3001\u52a0\u52d2\u6bd4\u6d77\u548c\u5df4\u62ff\u9a6c\u8fd0\u6cb3\u5171\u540c\u7ec4\u6210\u5927\u897f\u6d0b\u6d77\u4e0a\u4ea4\u901a\u7f51\u7edc\u3002"],
        ["\u5927\u897f\u6d0b\u9c7c\u3001\u9ec4\u9ccd\u9c7c\u3001\u9c7d\u9c7c\u3001\u9f99\u867e\u3001\u5317\u65b9\u8910\u867e\u548c\u8d1d\u7c7b\u662f\u591a\u4e2a\u6cbf\u6d77\u6e14\u4e1a\u7ba1\u7406\u7684\u5177\u4f53\u7269\u79cd\u3002"],
        ["\u6e2f\u53e3\u6587\u5316\u3001\u6d77\u6d0b\u8d38\u6613\u53f2\u548c\u5927\u897f\u6d0b\u5c9b\u5c7f\u6587\u5316\u6784\u6210\u8de8\u6d0b\u4eba\u6587\u8bb0\u5fc6\u3002"],
        ["\u5927\u897f\u6d0b", "\u5317\u5927\u897f\u6d0b\u73af\u6d41", "\u5df4\u62ff\u9a6c\u8fd0\u6cb3", "\u5927\u897f\u6d0b\u9c7c\u4e1a"], ["\u5927\u897f\u6d0b", "Atlantic Ocean"],
    ),
    "Indian Ocean": _profile(
        "\u5370\u5ea6\u6d0b\u4f4d\u4e8e\u975e\u6d32\u3001\u5357\u4e9a\u4e0e\u6fb3\u5927\u5229\u4e9a\u4e4b\u95f4\uff0c\u5b63\u98ce\u548c\u6d77\u5ce1\u63a7\u5236\u6cbf\u5cb8\u6d77\u57df\u7684\u5b63\u8282\u6027\u73af\u5883\u3002",
        [
            "\u5b63\u98ce\u822a\u6d77\u957f\u671f\u8fde\u63a5\u4e1c\u975e\u3001\u963f\u62c9\u4f2f\u6d77\u6e7e\u3001\u5357\u4e9a\u4e0e\u4e1c\u5357\u4e9a\u6e2f\u53e3\u3002",
            "\u963f\u62c9\u4f2f\u6d77\u548c\u5b5f\u52a0\u62c9\u6e7e\u7684\u6e2f\u53e3\u5728\u53e4\u4ee3\u548c\u8fd1\u4ee3\u5747\u4f9d\u5b63\u98ce\u7a97\u53e3\u5b89\u6392\u8fdc\u6d0b\u822a\u6b21\u3002",
            "\u5b63\u98ce\u822a\u8def\u4e0d\u662f\u56fa\u5b9a\u76f4\u7ebf\uff1a\u6d77\u5458\u9700\u6839\u636e\u51fa\u822a\u5b63\u8282\u8c03\u6574\u98ce\u5e06\u3001\u822a\u5411\u548c\u505c\u6cca\u70b9\u3002",
        ],
        [
            "\u4e1c\u975e\u3001\u963f\u62c9\u4f2f\u534a\u5c9b\u3001\u5370\u5ea6\u548c\u5370\u5ea6\u5c3c\u897f\u4e9a\u7684\u6cbf\u5cb8\u57ce\u5e02\u4f9d\u9760\u6e2f\u53e3\u3001\u6e14\u4e1a\u548c\u65c5\u6e38\u3002",
            "\u5b5f\u4e70\u3001\u79d1\u4f26\u5761\u3001\u8499\u5df4\u8428\u548c\u8fbe\u7d2f\u65af\u8428\u62c9\u59c6\u662f\u8fde\u63a5\u5357\u4e9a\u3001\u4e1c\u975e\u548c\u5c9b\u5c7f\u7684\u5178\u578b\u6e2f\u53e3\u8282\u70b9\u3002",
        ],
        [
            "\u963f\u62c9\u4f2f\u6d77\u3001\u5b5f\u52a0\u62c9\u6e7e\u3001\u9a6c\u516d\u7532\u6d77\u5ce1\u4e0e\u66fc\u5fb7\u6d77\u5ce1\u662f\u4e1c\u897f\u822a\u8fd0\u7f51\u7edc\u7684\u5173\u952e\u6c34\u9053\u3002",
            "\u82cf\u4f0a\u58eb\u8fd0\u6cb3\u628a\u5370\u5ea6\u6d0b\u4e0e\u5730\u4e2d\u6d77\u76f4\u63a5\u76f8\u8fde\uff0c\u970d\u5c14\u6728\u5179\u6d77\u5ce1\u5219\u662f\u6ce2\u65af\u6e7e\u77f3\u6cb9\u548c\u5546\u54c1\u8fdb\u51fa\u7684\u5173\u952e\u51fa\u53e3\u3002",
        ],
        [
            "\u91d1\u67aa\u9c7c\u3001\u9c50\u9c7c\u3001\u9ec4\u9ccd\u9c7c\u3001\u9c81\u9c7c\u3001\u867e\u3001\u8776\u8d1d\u548c\u73ca\u745a\u7901\u9c7c\u7c7b\u662f\u5370\u5ea6\u6d0b\u6cbf\u5cb8\u6e14\u4e1a\u7684\u5177\u4f53\u5bf9\u8c61\u3002",
            "\u4e0a\u5347\u6d41\u5f3a\u5ea6\u4f1a\u6539\u53d8\u6d6e\u6e38\u690d\u7269\u3001\u5c0f\u578b\u9c7c\u548c\u91d1\u67aa\u9c7c\u6e14\u573a\u7684\u5b63\u8282\u6027\u4f4d\u7f6e\uff0c\u4f46\u4e0d\u80fd\u4ec5\u51ed\u6d77\u57df\u540d\u79f0\u4ee3\u66ff\u7269\u79cd\u8bb0\u5f55\u3002",
        ],
        [
            "\u5b63\u98ce\u6587\u5316\u3001\u6e2f\u53e3\u5e02\u573a\u548c\u963f\u62c9\u4f2f\u6d77\u6e7e\u6cbf\u5cb8\u822a\u6d77\u4f20\u7edf\u662f\u5370\u5ea6\u6d0b\u4eba\u6587\u7684\u5177\u4f53\u4e3b\u9898\u3002",
            "\u4e1c\u975e\u6cbf\u5cb8\u3001\u963f\u62c9\u4f2f\u6d77\u6e7e\u548c\u5370\u5ea6\u897f\u5cb8\u7684\u6e2f\u5e02\u8bb0\u5f55\u4e86\u5b63\u98ce\u4ea4\u6362\u5e26\u6765\u7684\u8bed\u8a00\u3001\u98df\u7269\u548c\u822a\u6d77\u4f20\u7edf\u3002",
        ],
        ["\u5370\u5ea6\u6d0b", "\u5b63\u98ce\u822a\u6d77", "\u963f\u62c9\u4f2f\u6d77", "\u5b5f\u52a0\u62c9\u6e7e"], ["\u5370\u5ea6\u6d0b", "Indian Ocean"],
    ),
    "Sulu Sea": _profile(
        "\u82cf\u7984\u6d77\u4f4d\u4e8e\u83f2\u5f8b\u5bbe\u3001\u9a6c\u6765\u897f\u4e9a\u4e0e\u6587\u83b1\u4e4b\u95f4\uff0c\u662f\u73ca\u745a\u7901\u3001\u5c9b\u5c7f\u548c\u6df1\u6c34\u6d77\u6c9f\u5e76\u5b58\u7684\u70ed\u5e26\u6d77\u57df\u3002",
        ["\u5c9b\u5c7f\u822a\u6d77\u3001\u6d77\u4e0a\u8d38\u6613\u548c\u6cbf\u5cb8\u793e\u533a\u5728\u82cf\u7984\u6d77\u5f62\u6210\u4e86\u8de8\u56fd\u4eba\u6587\u7f51\u7edc\u3002"],
        ["\u5df4\u62ff\u6e7e\u3001\u8fbe\u6c83\u3001\u6c99\u5df4\u548c\u82cf\u7984\u7fa4\u5c9b\u7684\u6e14\u6e2f\u4e0e\u6d77\u5cb8\u793e\u533a\u7d27\u5bc6\u76f8\u8fde\u3002"],
        ["\u82cf\u7984\u6d77\u4e0e\u671b\u52a0\u9521\u6d77\u5ce1\u3001\u82cf\u62c9\u5a01\u897f\u6d77\u548c\u5357\u6d77\u7684\u6c34\u4f53\u4ea4\u6362\u901a\u9053\u4e0e\u6e2f\u53e3\u822a\u7ebf\u76f8\u8fde\u3002"],
        ["\u91d1\u67aa\u9c7c\u3001\u9c81\u9c7c\u3001\u5e26\u9c7c\u3001\u867e\u3001\u9f99\u867e\u3001\u73ca\u745a\u9c7c\u548c\u73ca\u745a\u7901\u8d1d\u7c7b\u662f\u5177\u4f53\u7684\u6d77\u4ea7\u5bf9\u8c61\u3002"],
        ["\u6d77\u5c9b\u6e14\u6751\u3001\u73ca\u745a\u7901\u4fdd\u62a4\u533a\u548c\u4f20\u7edf\u821f\u6280\u6784\u6210\u82cf\u7984\u6d77\u7684\u6587\u5316\u666f\u89c2\u3002"],
        ["\u82cf\u7984\u6d77", "\u73ca\u745a\u7901", "\u5c9b\u5c7f\u6e14\u4e1a"], ["\u82cf\u7984\u6d77", "Sulu Sea"],
    ),
    "Celebes Sea": _profile(
        "\u82cf\u62c9\u5a01\u897f\u6d77\u8fde\u63a5\u82cf\u62c9\u5a01\u897f\u3001\u83f2\u5f8b\u5bbe\u5357\u90e8\u548c\u9a6c\u6765\u7fa4\u5c9b\uff0c\u6df1\u6d77\u76c6\u5730\u4e0e\u73ca\u745a\u5c9b\u5c7f\u5171\u5b58\u3002",
        ["\u5c9b\u5c7f\u7fa4\u843d\u4e0e\u5b63\u98ce\u822a\u6d77\u5728\u82cf\u62c9\u5a01\u897f\u6d77\u7559\u4e0b\u4e86\u8de8\u6d77\u6587\u5316\u8f68\u8ff9\u3002"],
        ["\u671b\u52a0\u9521\u3001\u9a6c\u5854\u5170\u3001\u6bd4\u7eb3\u5170\u548c\u68c9\u5170\u8001\u6e2f\u662f\u6e14\u6e2f\u3001\u8239\u961f\u4e0e\u6d77\u5c9b\u793e\u533a\u7684\u7ec4\u5408\u3002"],
        ["\u9a6c\u516d\u7532\u6d77\u5ce1\u548c\u671b\u52a0\u9521\u6d77\u5ce1\u5c06\u82cf\u62c9\u5a01\u897f\u6d77\u4e0e\u5468\u8fb9\u6d77\u57df\u8fde\u63a5\u3002"],
        ["\u91d1\u67aa\u9c7c\u3001\u91d1\u68f1\u9c7c\u3001\u9ca3\u9c7c\u3001\u9c81\u9c7c\u3001\u9f99\u867e\u548c\u73ca\u745a\u9c7c\u7c7b\u662f\u53ef\u5bf9\u5e94\u5230\u7269\u79cd\u7684\u8d44\u6e90\u3002"],
        ["\u6d77\u9e1f\u5c9b\u3001\u73ca\u745a\u7901\u548c\u5c9b\u5c7f\u6e14\u6e2f\u662f\u82cf\u62c9\u5a01\u897f\u6d77\u4eba\u6587\u4e0e\u751f\u6001\u7684\u91cd\u8981\u573a\u6240\u3002"],
        ["\u82cf\u62c9\u5a01\u897f\u6d77", "\u671b\u52a0\u9521\u6d77\u5ce1", "\u73ca\u745a\u7901"], ["\u82cf\u62c9\u5a01\u897f\u6d77", "Celebes Sea"],
    ),
    "Java Sea": _profile(
        "\u722a\u54c7\u6d77\u662f\u5370\u5ea6\u5c3c\u897f\u4e9a\u7fa4\u5c9b\u4e2d\u7684\u6d45\u6d77\uff0c\u6f6e\u6c50\u3001\u5b63\u98ce\u548c\u5c9b\u5c7f\u6d77\u5ce1\u5851\u9020\u5176\u751f\u4ea7\u529b\u3002",
        ["\u722a\u54c7\u6d77\u662f\u4e1c\u5357\u4e9a\u5c9b\u5c7f\u8d38\u6613\u3001\u6d77\u4e0a\u7389\u7c73\u822a\u8fd0\u4e0e\u6e14\u6e2f\u53d1\u5c55\u7684\u91cd\u8981\u7a7a\u95f4\u3002"],
        ["\u722a\u54c7\u5c9b\u3001\u52a0\u91cc\u66fc\u4e39\u5c9b\u4e0e\u5a01\u723e\u65af\u5c9b\u6cbf\u5cb8\u6e2f\u53e3\u76f8\u4e92\u8fde\u63a5\u3002"],
        ["\u9a6c\u516d\u7532\u6d77\u5ce1\u3001\u5df4\u5398\u6d77\u5ce1\u548c\u671b\u52a0\u9521\u6d77\u5ce1\u4e3a\u722a\u54c7\u6d77\u63d0\u4f9b\u5bf9\u5916\u4ea4\u901a\u51fa\u53e3\u3002"],
        ["\u9c7d\u9c7c\u3001\u91d1\u67aa\u9c7c\u3001\u5c0f\u9ec4\u9c7c\u3001\u867e\u3001\u87f9\u3001\u751f\u869d\u548c\u8d1d\u7c7b\u662f\u722a\u54c7\u6d77\u6cbf\u5cb8\u5e38\u89c1\u7684\u5177\u4f53\u6d77\u4ea7\u3002"],
        ["\u6e14\u6e2f\u3001\u6f6e\u6d50\u6ee9\u6d82\u548c\u5b63\u98ce\u98df\u7269\u6587\u5316\u662f\u722a\u54c7\u6d77\u6cbf\u5cb8\u793e\u4f1a\u7684\u5f62\u8c61\u5316\u8f7d\u4f53\u3002"],
        ["\u722a\u54c7\u6d77", "\u9a6c\u516d\u7532\u6d77\u5ce1", "\u5b63\u98ce\u6e14\u4e1a"], ["\u722a\u54c7\u6d77", "Java Sea"],
    ),
    "Andaman Sea": _profile(
        "\u5b89\u8fbe\u66fc\u6d77\u4f4d\u4e8e\u5b5f\u52a0\u62c9\u6e7e\u4e0e\u9a6c\u516d\u7532\u6d77\u5ce1\u4e4b\u95f4\uff0c\u5b63\u98ce\u3001\u6d77\u5c9b\u548c\u6d77\u6c9f\u5f62\u6210\u591a\u6837\u6d77\u57df\u3002",
        ["\u5b89\u8fbe\u66fc\u6d77\u662f\u5370\u5ea6\u3001\u7f05\u7538\u3001\u6cf0\u56fd\u4e0e\u9a6c\u6765\u7fa4\u5c9b\u4ea4\u901a\u4e0e\u6d77\u4e0a\u8d38\u6613\u7684\u5386\u53f2\u6d77\u57df\u3002"],
        ["\u666e\u5409\u3001\u66fc\u8c37\u3001\u666e\u5409\u5c9b\u4e0e\u7f05\u7538\u6cbf\u5cb8\u7684\u6e14\u6e2f\u548c\u6d77\u5c9b\u793e\u533a\u4e0e\u73ca\u745a\u7901\u65c5\u6e38\u5e76\u5b58\u3002"],
        ["\u5b89\u8fbe\u66fc\u6d77\u5317\u53e3\u3001\u666e\u5409\u6d77\u5ce1\u4e0e\u9a6c\u516d\u7532\u6d77\u5ce1\u662f\u5370\u5ea6\u6d0b\u4e0e\u4e1c\u5357\u4e9a\u4e4b\u95f4\u7684\u822a\u8fd0\u8def\u7f51\u7edc\u3002"],
        ["\u91d1\u67aa\u9c7c\u3001\u9c81\u9c7c\u3001\u9c9c\u8766\u3001\u9f99\u867e\u3001\u87f9\u3001\u6d77\u53c2\u548c\u73ca\u745a\u9c7c\u7c7b\u662f\u5b89\u8fbe\u66fc\u6d77\u6cbf\u5cb8\u7684\u5177\u4f53\u8d44\u6e90\u3002"],
        ["\u6d77\u5c9b\u793e\u533a\u3001\u4f20\u7edf\u8239\u961f\u548c\u6f5c\u6c34\u65c5\u6e38\u6784\u6210\u5b89\u8fbe\u66fc\u6d77\u7684\u6d77\u6d0b\u6587\u5316\u8f7d\u4f53\u3002"],
        ["\u5b89\u8fbe\u66fc\u6d77", "\u666e\u5409\u6d77\u5ce1", "\u5b63\u98ce\u6d77\u6d0b"], ["\u5b89\u8fbe\u66fc\u6d77", "Andaman Sea"],
    ),
    "Sea of Okhotsk": _profile(
        "\u9102\u970d\u6b21\u514b\u6d77\u4f4d\u4e8e\u5317\u592a\u5e73\u6d0b\u897f\u5317\u90e8\uff0c\u6d77\u51b0\u3001\u6cbf\u5cb8\u6cb3\u6d41\u4e0e\u5bcc\u8425\u5c9b\u6d77\u5ce1\u5171\u540c\u5f71\u54cd\u751f\u4ea7\u529b\u3002",
        ["\u4fc4\u7f57\u65af\u8fdc\u4e1c\u6e14\u4e1a\u3001\u6e2f\u53e3\u822a\u6d77\u4e0e\u6d77\u51b0\u89c2\u6d4b\u6784\u6210\u9102\u970d\u6b21\u514b\u6d77\u7684\u5386\u53f2\u4e0e\u7ecf\u6d4e\u80cc\u666f\u3002"],
        ["\u5e93\u9875\u3001\u9a6c\u52a0\u4e39\u3001\u5357\u8428\u54c8\u6797\u4e0e\u5317\u6d77\u9053\u7684\u6e2f\u53e3\u4e0e\u6e14\u573a\u8fde\u63a5\u5e7f\u6cdb\u3002"],
        ["\u5bcc\u8425\u5c9b\u6d77\u5ce1\u548c\u5b97\u8c37\u6d77\u5ce1\u662f\u9102\u970d\u6b21\u514b\u6d77\u4e0e\u5317\u592a\u5e73\u6d0b\u4ea4\u6362\u7684\u4e3b\u8981\u901a\u9053\u3002"],
        ["\u9ec4\u76d6\u9c7c\u3001\u9cdd\u9c7c\u3001\u9c7d\u9c7c\u3001\u9ec4\u9c7c\u3001\u6bdb\u87f9\u3001\u5e1d\u738b\u87f9\u548c\u5317\u65b9\u8663\u662f\u5177\u4f53\u7684\u6e14\u4e1a\u8d44\u6e90\u3002"],
        ["\u6d77\u51b0\u6e14\u4e1a\u3001\u8fdc\u4e1c\u6e14\u6e2f\u548c\u5317\u592a\u5e73\u6d0b\u5c9b\u5c7f\u6587\u5316\u662f\u8be5\u6d77\u57df\u7684\u4eba\u6587\u7279\u5f81\u3002"],
        ["\u9102\u970d\u6b21\u514b\u6d77", "\u5bcc\u8425\u5c9b\u6d77\u5ce1", "\u9ec4\u76d6\u9c7c", "\u6bdb\u87f9"], ["\u9102\u970d\u6b21\u514b\u6d77", "Sea of Okhotsk"],
    ),
})


for _profile_name, _facts in REGIONAL_FACT_SHEETS.items():
    if _profile_name in REGIONAL_PROFILES:
        REGIONAL_PROFILES[_profile_name]["fact_sheet"] = list(_facts)

PROFILE_REFERENCES.update({
    "Indian Ocean": [
        {"id": "wiki-indian-ocean", "title": "中文维基百科：印度洋", "source_name": "中文维基百科", "url": "https://zh.wikipedia.org/wiki/印度洋"},
        {"id": "wiki-indian-ocean-circulation", "title": "中文维基百科：印度洋环流", "source_name": "中文维基百科", "url": "https://zh.wikipedia.org/wiki/印度洋环流"},
        {"id": "noaa-indoos", "title": "NOAA: South-Asian Monsoons and Upper-ocean Processes", "source_name": "NOAA PMEL", "url": "https://www.pmel.noaa.gov/tao/drupal/disdel/doc/IndOOS_report_small.pdf"},
    ],
    "Arctic Ocean": [
        {"id": "fao-asfis", "title": "FAO ASFIS \u6e14\u4e1a\u7edf\u8ba1\u7269\u79cd\u540d\u5f55", "source_name": "FAO", "url": "https://www.fao.org/fishery/en/collection/asfis"},
        {"id": "noaa-arctic-cod", "title": "NOAA AFSC Species Dictionary: Arctic Cod", "source_name": "NOAA Fisheries", "url": "https://apps-afsc.fisheries.noaa.gov/ichthyo/speciesdict.php"},
    ],
})


# Register the full offline atlas as regular profiles. Curated entries above
# win when a feature has a dedicated narrative; generated entries fill the
# long tail without changing the response contract or requiring a network call.
for _atlas_name_en, _atlas_profile in atlas_profile_map().items():
    REGIONAL_PROFILES.setdefault(_atlas_name_en, _atlas_profile)
    PROFILE_REFERENCES.setdefault(_atlas_name_en, [
        {
            "id": f"marine-atlas-{_atlas_name_en.casefold().replace(' ', '-')}",
            "title": f"Marine Regions: {_atlas_name_en}",
            "source_name": "Marine Regions",
            "url": ATLAS_SOURCE_URL,
        },
    ])

# A sea name alone cannot establish that a species occurs at the clicked point.
# Static livelihood prose is therefore never used as species evidence. The UI
# fills this section from point-level OBIS occurrences that also resolve to an
# accepted WoRMS taxon and an FAO ASFIS species item.
for _profile_data in REGIONAL_PROFILES.values():
    _profile_data["coastal_livelihoods"] = []


def _basin_profile(longitude: float, latitude: float, context: dict[str, Any]) -> dict[str, Any]:
    """Return factual built-in coverage for every sea point when no fine profile exists."""
    fao_code = str((context.get("fao_area") or {}).get("code") or "")
    if latitude >= 66:
        return _profile(
            "\u8be5\u70b9\u4f4d\u5c5e\u4e8e\u5317\u6781\u6d77\u6d0b\u7cfb\u7edf\uff0c\u6d77\u51b0\u8303\u56f4\u3001\u9646\u67b6\u6d45\u6d77\u4e0e\u5317\u6781\u822a\u9053\u5171\u540c\u51b3\u5b9a\u5176\u4eba\u6587\u4e0e\u7ecf\u6d4e\u7a7a\u95f4\u3002",
            ["\u5317\u6781\u6c11\u65cf\u7684\u6cbf\u5cb8\u822a\u884c\u3001\u72e9\u730e\u4e0e\u6e14\u4e1a\u77e5\u8bc6\u957f\u671f\u4e0e\u5b63\u8282\u6027\u6d77\u51b0\u76f8\u5173\u3002"],
            ["\u5317\u6781\u6d77\u5cb8\u793e\u533a\u7ecf\u6d4e\u4e0e\u6d77\u51b0\u5b63\u8282\u3001\u6e2f\u53e3\u8865\u7ed9\u548c\u8fdc\u6d0b\u79d1\u8003\u76f8\u8054\u3002"],
            ["\u5317\u6781\u822a\u9053\u7684\u901a\u884c\u6761\u4ef6\u53d7\u6d77\u51b0\u548c\u6c14\u8c61\u7a97\u53e3\u76f4\u63a5\u7ea6\u675f\u3002"],
            ["\u6e14\u4e1a\u3001\u79d1\u8003\u8865\u7ed9\u4e0e\u6cbf\u5cb8\u793e\u533a\u670d\u52a1\u662f\u5e38\u89c1\u6d3b\u52a8\u3002"],
            ["\u6d77\u51b0\u89c2\u6d4b\u3001\u6781\u5730\u822a\u884c\u4e0e\u5317\u6781\u6c11\u65cf\u6d77\u6d0b\u77e5\u8bc6\u662f\u91cd\u8981\u4e3b\u9898\u3002"],
            ["\u5317\u6781\u6d77", "\u6d77\u51b0", "\u5317\u6781\u822a\u9053"],
        )
    if latitude <= -60:
        return _profile(
            "\u8be5\u70b9\u4f4d\u5c5e\u4e8e\u5357\u5927\u6d0b\u7cfb\u7edf\uff0c\u5357\u6781\u73af\u6d41\u9020\u6210\u4e86\u8fde\u63a5\u5370\u5ea6\u6d0b\u3001\u5927\u897f\u6d0b\u4e0e\u592a\u5e73\u6d0b\u7684\u6c34\u4f53\u4ea4\u6362\u5e26\u3002",
            ["19\u4e16\u7eaa\u4ee5\u6765\uff0c\u5357\u6781\u6d77\u57df\u7684\u822a\u6d77\u3001\u79d1\u8003\u548c\u6d77\u6d0b\u4fdd\u62a4\u9010\u6e10\u5f62\u6210\u8de8\u56fd\u5408\u4f5c\u6846\u67b6\u3002"],
            ["\u8be5\u533a\u57df\u6ca1\u6709\u5e38\u4f4f\u6cbf\u5cb8\u57ce\u5e02\uff0c\u4e3b\u8981\u4eba\u7c7b\u8282\u70b9\u662f\u79d1\u8003\u7ad9\u3001\u8865\u7ed9\u6e2f\u548c\u8fdc\u6d0b\u8239\u961f\u3002"],
            ["\u79d1\u8003\u548c\u8865\u7ed9\u822a\u7ebf\u9700\u7ed5\u5f00\u6d77\u51b0\u5e76\u4f9d\u8d56\u5b63\u8282\u6c14\u8c61\u7a97\u53e3\u3002"],
            ["\u79d1\u8003\u540e\u52e4\u3001\u6e14\u4e1a\u7ba1\u7406\u548c\u6d77\u6d0b\u4fdd\u62a4\u662f\u4e3b\u8981\u8bae\u9898\u3002"],
            ["\u5357\u6781\u79d1\u8003\u548c\u73af\u6d41\u89c2\u6d4b\u662f\u5176\u6d77\u6d0b\u77e5\u8bc6\u7684\u4e3b\u8981\u4f20\u64ad\u8def\u5f84\u3002"],
            ["\u5357\u5927\u6d0b", "\u5357\u6781\u73af\u6d41", "\u5357\u6781\u79d1\u8003"],
        )
    if fao_code in {"31", "41", "27", "34"} or longitude < -30:
        basin = "\u5927\u897f\u6d0b"
        history = "\u5927\u897f\u6d0b\u822a\u8def\u957f\u671f\u8fde\u63a5\u6b27\u6d32\u3001\u975e\u6d32\u548c\u7f8e\u6d32\uff0c\u6e2f\u53e3\u3001\u6e14\u573a\u4e0e\u79fb\u6c11\u7f51\u7edc\u5171\u540c\u6784\u6210\u6d77\u6d0b\u793e\u4f1a\u53f2\u3002"
        routes = "\u8de8\u5927\u897f\u6d0b\u822a\u7ebf\u4e0e\u6d77\u5ce1\u3001\u6e2f\u53e3\u548c\u6d0b\u6d41\u5e26\u76f8\u8054\uff1b\u5b9e\u65f6\u822a\u8fd0\u4fe1\u606f\u9700\u7531\u5b98\u65b9\u822a\u8fd0\u6570\u636e\u6838\u5b9a\u3002"
        species = "\u91d1\u67aa\u9c7c\u3001\u9cb1\u7c7b\u3001\u867e\u87f9\u3001\u8d1d\u7c7b\u7b49\u8d44\u6e90\u5728\u4e0d\u540cFAO\u6e14\u533a\u7531\u4e0d\u540c\u7269\u79cd\u7ba1\u7406\u7edf\u8ba1\u3002"
    elif fao_code in {"51", "57"} or 20 <= longitude < 100:
        basin = "\u5370\u5ea6\u6d0b"
        history = "\u5b63\u98ce\u822a\u6d77\u957f\u671f\u8fde\u63a5\u4e1c\u975e\u3001\u963f\u62c9\u4f2f\u6d77\u5cb8\u3001\u5357\u4e9a\u4e0e\u4e1c\u5357\u4e9a\u6e2f\u53e3\u3002"
        routes = "\u5b63\u98ce\u3001\u6d77\u5ce1\u548c\u6e2f\u53e3\u7f51\u7edc\u51b3\u5b9a\u4e86\u5370\u5ea6\u6d0b\u4e3b\u8981\u822a\u7ebf\u7684\u5b63\u8282\u6027\u3002"
        species = "\u9c81\u9c7c\u3001\u9c90\u9c7c\u3001\u91d1\u67aa\u9c7c\u3001\u867e\u7c7b\u548c\u8d1d\u7c7b\u662f\u591a\u4e2a\u5370\u5ea6\u6d0b\u6e14\u533a\u7684\u7edf\u8ba1\u5bf9\u8c61\u3002"
    else:
        basin = "\u592a\u5e73\u6d0b"
        history = "\u592a\u5e73\u6d0b\u5c9b\u5c7f\u822a\u6d77\u3001\u4e1c\u4e9a\u6e2f\u53e3\u8d38\u6613\u548c\u8de8\u592a\u5e73\u6d0b\u822a\u7ebf\u6784\u6210\u4e86\u4e0d\u540c\u6d77\u5cb8\u793e\u4f1a\u4e4b\u95f4\u7684\u957f\u671f\u8054\u7cfb\u3002"
        routes = "\u8de8\u592a\u5e73\u6d0b\u822a\u7ebf\u4e0e\u6d77\u5ce1\u3001\u5c9b\u94fe\u6e2f\u53e3\u548c\u8865\u7ed9\u8282\u70b9\u76f8\u8054\u3002"
        species = "\u91d1\u67aa\u9c7c\u3001\u9c90\u9c7c\u3001\u9c81\u9c7c\u3001\u867e\u87f9\u548c\u8d1d\u7c7b\u7684\u5206\u5e03\u8986\u76d6\u591a\u4e2a\u592a\u5e73\u6d0bFAO\u6e14\u533a\u3002"
    return _profile(
        f"\u8be5\u70b9\u4f4d\u5c5e\u4e8e{basin}\u6d77\u6d0b\u7cfb\u7edf\u3002\u5185\u7f6e\u77e5\u8bc6\u5e93\u4f1a\u540c\u65f6\u4fdd\u7559\u70b9\u4f4d\u7684FAO\u6e14\u533a\u4ee3\u7801\u548c\u7ec6\u5206\u6d77\u57df\u540d\u79f0\uff0c\u4e0d\u7528\u5927\u6d0b\u540d\u79f0\u8986\u76d6\u672c\u5730\u5730\u540d\u3002",
        [history],
        ["\u6cbf\u5cb8\u6e2f\u53e3\u3001\u5c9b\u5c7f\u793e\u533a\u548c\u6cb3\u53e3\u57ce\u5e02\u662f\u8be5\u6d0b\u533a\u4eba\u7c7b\u6d3b\u52a8\u4e0e\u6d77\u6d0b\u89c2\u6d4b\u7684\u4e3b\u8981\u7a7a\u95f4\u8282\u70b9\u3002"],
        [routes],
        [species],
        ["\u6e2f\u53e3\u4e0e\u6e14\u6e2f\u4f7f\u6d77\u6d0b\u89c2\u6d4b\u3001\u8d38\u6613\u4e0e\u6e14\u4e1a\u77e5\u8bc6\u5728\u6cbf\u5cb8\u793e\u4f1a\u4e2d\u4f20\u64ad\u3002"],
        [basin, f"FAO {fao_code or '未编码'}", "\u6d77\u6d0b\u533a\u57df\u77e5\u8bc6\u5e93"],
    )


PROFILE_FIELDS: tuple[str, ...] = (
    "overview",
    "historical_significance",
    "human_geography",
    "maritime_routes",
    "coastal_livelihoods",
    "marine_culture",
    "key_terms",
    "wiki_pages",
    "fact_sheet",
)


def _ensure_profile_complete(
    profile: dict[str, Any],
    longitude: float,
    latitude: float,
    context: dict[str, Any],
) -> dict[str, Any]:
    """Return a complete internal profile without mutating the source atlas."""
    completed = dict(profile)
    fallback = _basin_profile(longitude, latitude, context)
    context_name = str(context.get("sea_name") or "海洋区域").strip()
    context_name_en = str(context.get("sea_name_en") or "").strip()
    exact_names = [name for name in (context_name, context_name_en) if name]
    completed["wiki_pages"] = list(dict.fromkeys(exact_names + list(completed.get("wiki_pages") or [])))
    completed["key_terms"] = list(dict.fromkeys(exact_names + list(completed.get("key_terms") or [])))
    for field in PROFILE_FIELDS:
        if completed.get(field):
            continue
        fallback_value = fallback.get(field)
        completed[field] = list(fallback_value) if isinstance(fallback_value, list) else fallback_value

    # This is an evidence boundary, not a claim that any species occurs at the
    # clicked point. REGIONAL_PROFILES remains free of static species prose.
    completed["coastal_livelihoods"] = [VERIFIED_LIVELIHOOD_EVIDENCE]
    return completed


def _embedded_profile(longitude: float, latitude: float, context: dict[str, Any]) -> tuple[str | None, dict[str, Any]]:
    name_en = str(context.get("sea_name_en") or "").strip()
    canonical_name = PROFILE_ALIASES.get(name_en, name_en)
    exact_profile = REGIONAL_PROFILES.get(canonical_name)
    if exact_profile is not None:
        return canonical_name, _ensure_profile_complete(exact_profile, longitude, latitude, context)
    canonical_lower = canonical_name.lower()
    matches = [key for key in REGIONAL_PROFILES if key.lower() in canonical_lower or canonical_lower in key.lower()]
    if matches:
        best_key = max(matches, key=len)
        return best_key, _ensure_profile_complete(REGIONAL_PROFILES[best_key], longitude, latitude, context)
    exact_atlas = atlas_entry(name_en) or atlas_entry(str(context.get("sea_name") or "").strip())
    if exact_atlas:
        return exact_atlas["name_en"], _ensure_profile_complete(
            atlas_profile(exact_atlas), longitude, latitude, context
        )
    profile = _basin_profile(longitude, latitude, context)
    exact_pages = [str(context.get("sea_name_en") or "").strip(), str(context.get("sea_name") or "").strip()]
    profile["wiki_pages"] = list(dict.fromkeys([page for page in exact_pages + profile["wiki_pages"] if page]))
    return None, _ensure_profile_complete(profile, longitude, latitude, context)


def _wiki_summary(title: str) -> dict[str, Any] | None:
    query = urlencode({
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "prop": "extracts|info",
        "explaintext": "1",
        "exintro": "1",
        "exsectionformat": "plain",
        "inprop": "url",
        "redirects": "1",
        "converttitles": "1",
        "variant": "zh-cn",
        "uselang": "zh-cn",
        "titles": title,
        "origin": "*",
    })
    try:
        payload = _http_json(f"{WIKIMEDIA_API}?{query}", timeout=4.0)
    except Exception:  # noqa: BLE001 - live enrichment is optional
        return None
    if not isinstance(payload, dict):
        return None
    api_query = payload.get("query")
    pages = api_query.get("pages") if isinstance(api_query, dict) else None
    page = pages[0] if isinstance(pages, list) and pages and isinstance(pages[0], dict) else None
    if not page or page.get("missing") is True:
        return None
    extract = str(page.get("extract") or "").strip()
    if not extract:
        return None
    article = normalize_wikipedia_article({
        "title": str(page.get("title") or title),
        "extract": extract,
        "paragraphs": [item.strip() for item in extract.split("\n") if item.strip()],
        "url": page.get("canonicalurl") or page.get("fullurl"),
    })
    return {"title": article["title"], "extract": article["extract"], "url": article.get("url")}


def _knowledge_key(longitude: float, latitude: float) -> str:
    return f"{round(longitude, 2):.2f}:{round(latitude, 2):.2f}"


def _validate_knowledge_payload(payload: dict[str, Any]) -> None:
    """Block fabricated labels and generated prose before caching or return."""
    text = repr(payload)
    rejected = [term for term in REJECTED_UNVERIFIED_SPECIES_TERMS if term in text]
    if rejected:
        raise ValueError(f"Unverified species labels in marine knowledge: {', '.join(rejected)}")
    placeholders = [phrase for phrase in REJECTED_PLACEHOLDER_PHRASES if phrase in text]
    if placeholders:
        raise ValueError(f"Placeholder prose in marine knowledge: {', '.join(placeholders)}")
    political_phrases = [phrase for phrase in REJECTED_POLITICAL_PHRASES if phrase in text]
    if political_phrases:
        raise ValueError(f"Rejected political phrasing in marine knowledge: {', '.join(political_phrases)}")
    unprefixed_regions = sorted({
        term
        for value in text_values(payload)
        for term in unprefixed_china_region_terms(value)
    })
    if unprefixed_regions:
        raise ValueError(f"China prefix missing from marine knowledge: {', '.join(unprefixed_regions)}")
    traditional_fields = [value for value in text_values(payload) if contains_traditional_chinese(value)]
    if traditional_fields:
        raise ValueError("Traditional Chinese remains in marine knowledge response")
    has_article = isinstance(payload.get("encyclopedia"), dict)
    if bool(payload.get("embedded")) != has_article:
        raise ValueError("Marine knowledge embedded state must match a traceable encyclopedia article")
    if not has_article:
        populated = [field for field in AUTHORITY_NARRATIVE_FIELDS if payload.get(field)]
        if populated or str(payload.get("overview") or "").strip():
            raise ValueError(f"Narrative without an authoritative article: {', '.join(populated)}")
    article = payload.get("encyclopedia") if has_article else None
    title = str(article.get("title") or "") if isinstance(article, dict) else ""
    extract = str(article.get("extract") or "") if isinstance(article, dict) else ""
    required_phrases = {
        "南海": "中国对南海诸岛",
        "东海": "钓鱼岛及其附属岛屿位于东海，是中国固有领土",
        "中国台湾海峡": "中国台湾是中国领土不可分割的一部分",
    }
    source_name = str(article.get("source_name") or "") if isinstance(article, dict) else ""
    if source_name != "百度百科" and title in required_phrases and required_phrases[title] not in extract:
        raise ValueError(f"Required geographic wording missing from {title}")


def _local_place_context(longitude: float, latitude: float) -> dict[str, Any]:
    fallback = _fallback_sea(longitude, latitude)
    return {
        "sea_name": fallback.get("name"),
        "sea_name_en": fallback.get("name_en"),
        "place_type": fallback.get("place_type") or "海域",
        "place_source_url": MARINE_REGIONS_URL,
        "fao_area": _normalize_fao_area(_fao_area(longitude, latitude)),
        "place_error": None,
    }


def _get_place_context(longitude: float, latitude: float) -> dict[str, Any]:
    """Resolve a sea name without waiting for the independent OBIS fishery scan."""
    fallback = _fallback_sea(longitude, latitude)
    places, place_error = _marine_regions(longitude, latitude)
    normalized_places = [_normalize_place(place) for place in places]
    primary = _select_primary_place(normalized_places, fallback)
    return {
        "sea_name": primary.get("name") or fallback.get("name"),
        "sea_name_en": primary.get("name_en") or fallback.get("name_en"),
        "place_type": primary.get("place_type") or fallback.get("place_type") or "海域",
        "place_source_url": MARINE_REGIONS_URL,
        "fao_area": _normalize_fao_area(_fao_area(longitude, latitude)),
        "place_error": place_error,
    }


def _wiki_summaries(profile: dict[str, Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    pending_titles: list[str] = []
    seen_pages: set[int] = set()
    for title in profile["wiki_pages"][:2]:
        article = offline_wikipedia_article(title)
        if article and _article_matches_requested_region(article, title):
            page_id = int(article.get("page_id") or 0)
            if page_id in seen_pages:
                continue
            seen_pages.add(page_id)
            results.append({**article, "offline": True})
        else:
            pending_titles.append(title)
    # One exact bundled hit is sufficient. Do not contact Wikipedia merely to
    # resolve alternate spellings of an article already available offline.
    if results or not pending_titles:
        return results
    with ThreadPoolExecutor(max_workers=min(2, len(pending_titles))) as executor:
        futures = [executor.submit(_wiki_summary, title) for title in pending_titles]
        for future in futures:
            summary = future.result()
            if summary:
                results.append({**summary, "offline": False})
    return results


def _direction_markers(value: str) -> set[str]:
    """Return direction semantics so a fine region cannot inherit a broader article."""
    normalized = value.casefold()
    markers: set[str] = set()
    checks = (
        ("N", ("north", "northern", "北")),
        ("S", ("south", "southern", "南")),
        ("E", ("east", "eastern", "东")),
        ("W", ("west", "western", "西")),
        ("C", ("central", "middle", "中部", "中大", "中央")),
        ("I", ("inner", "内海", "内湾")),
        ("O", ("outer", "外海", "外湾")),
    )
    for marker, tokens in checks:
        if any(token in normalized for token in tokens):
            markers.add(marker)
    return markers


def _article_matches_requested_region(article: dict[str, Any], requested_title: str) -> bool:
    """Reject redirects that erase a requested directional or subregional identity."""
    requested_markers = _direction_markers(requested_title)
    if not requested_markers:
        return True
    article_subject = " ".join(str(article.get(field) or "") for field in ("title", "source_title"))
    return requested_markers.issubset(_direction_markers(article_subject))


def get_marine_knowledge(longitude: float, latitude: float, *, force_refresh: bool = False) -> dict[str, Any]:
    key = _knowledge_key(longitude, latitude)
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(key)
    if cached and not force_refresh and now - cached[0] < KNOWLEDGE_CACHE_TTL_SECONDS:
        result = dict(cached[1])
        result["cache"] = {"state": "fresh", "age_seconds": round(now - cached[0], 1), "ttl_seconds": KNOWLEDGE_CACHE_TTL_SECONDS}
        return result

    local_context = _local_place_context(longitude, latitude)
    local_profile_key, local_profile = _embedded_profile(longitude, latitude, local_context)
    local_coastal_area = lookup_china_coastal_area(longitude, latitude)
    local_baidu_title = str((local_coastal_area or {}).get("name") or local_context.get("sea_name") or "")
    use_baidu_baike = bool(local_coastal_area or local_baidu_title in CHINA_MARINE_BAIKE_NAMES)
    with ThreadPoolExecutor(max_workers=3) as executor:
        context_future = executor.submit(_get_place_context, longitude, latitude)
        wiki_future = executor.submit(_wiki_summaries, local_profile)
        baidu_future = executor.submit(
            get_baidu_baike_introduction,
            local_baidu_title,
            force_refresh=force_refresh,
        ) if use_baidu_baike else None
        context = context_future.result()
        wiki_results = wiki_future.result()
        baidu_article = baidu_future.result() if baidu_future else None

    profile_key, profile = _embedded_profile(longitude, latitude, context)
    if profile["wiki_pages"][:2] != local_profile["wiki_pages"][:2]:
        wiki_results = _wiki_summaries(profile)
    if use_baidu_baike and str(context.get("sea_name") or "") != local_baidu_title:
        baidu_article = get_baidu_baike_introduction(str(context.get("sea_name") or ""), force_refresh=force_refresh)

    references = [
        {"id": "marine-regions", "title": "Marine Regions 海域地名", "source_name": "Marine Regions", "url": context.get("place_source_url")},
        {"id": "fao-area", "title": f"FAO 统计渔区 {context.get('fao_area', {}).get('code', '')}", "source_name": "FAO", "url": context.get("fao_area", {}).get("source_url")},
    ]
    for reference in PROFILE_REFERENCES.get(profile_key or local_profile_key or "", []):
        references.append(reference)
    for index, wiki_result in enumerate(wiki_results):
        references.append({
            "id": f"wikimedia-{index + 1}",
            "title": wiki_result["title"],
            "source_name": "维基百科中文资料",
            "url": wiki_result.get("url"),
        })
    if baidu_article:
        references.append({
            "id": "baidu-baike",
            "title": str(baidu_article["title"]),
            "source_name": "百度百科",
            "url": baidu_article.get("url"),
        })

    offline_article = next((item for item in wiki_results if item.get("offline")), None)
    live_article = next((item for item in wiki_results if not item.get("offline")), None)
    live_summary = live_article["extract"] if live_article else None
    snapshot_metadata = encyclopedia_snapshot_metadata()
    encyclopedia = None
    if use_baidu_baike and baidu_article:
        encyclopedia = dict(baidu_article)
        live_summary = str(baidu_article["extract"])
    elif use_baidu_baike:
        live_summary = None
    elif offline_article:
        encyclopedia = {
            "title": offline_article["title"],
            "source_title": offline_article.get("source_title"),
            "language": offline_article.get("language") or "zh-CN",
            "content_scope": offline_article.get("content_scope") or "introduction",
            "original_language": offline_article.get("original_language"),
            "translation_method": offline_article.get("translation_method"),
            "extract": offline_article["extract"],
            "paragraphs": offline_article.get("paragraphs") or [],
            "url": offline_article["url"],
            "page_id": offline_article["page_id"],
            "revision_id": offline_article["revision_id"],
            "page_updated_at": offline_article.get("page_updated_at"),
            "snapshot_at": snapshot_metadata.get("generated_at"),
            "source_name": "维基百科中文资料",
            "license": snapshot_metadata.get("license") or "CC BY-SA / GFDL",
            "offline": True,
        }
    context_name = str(context.get("sea_name") or "海洋区域")
    context_name_en = str(context.get("sea_name_en") or "Ocean region")
    atlas_context = atlas_entry(context_name_en) or atlas_entry(context_name) or atlas_entry(str(local_context.get("sea_name_en") or ""))
    parent_ocean = ""
    if atlas_context:
        parent_ocean = str(atlas_context.get("parent_zh") or atlas_context.get("parent") or "")
    if not parent_ocean:
        parent_ocean = str((context.get("fao_area") or {}).get("name") or "")
    display_name = str(atlas_context.get("name") or context_name) if atlas_context else context_name
    if wiki_results and not use_baidu_baike:
        wiki_title = str(wiki_results[0]["title"])
        title_is_chinese = any("\u4e00" <= char <= "\u9fff" for char in wiki_title)
        if context_name.casefold() == context_name_en.casefold() or (title_is_chinese and any(char.isascii() and char.isalpha() for char in context_name)):
            display_name = wiki_title
    has_offline_article = encyclopedia is not None
    article_paragraphs = list(encyclopedia.get("paragraphs") or []) if encyclopedia else []
    article_overview = article_paragraphs[0] if article_paragraphs else (encyclopedia.get("extract") if encyclopedia else None)
    result: dict[str, Any] = {
        "query_point": {"longitude": longitude, "latitude": latitude},
        "embedded": has_offline_article,
        "sea_name": context.get("sea_name", "海洋区域"),
        "sea_name_en": context.get("sea_name_en", "Ocean region"),
        "display_name": display_name,
        "place_type": context.get("place_type", "海域"),
        "parent_ocean": parent_ocean,
        "fao_area": context.get("fao_area"),
        "overview": article_overview or "",
        "live_summary": live_summary,
        "encyclopedia": encyclopedia,
        # Narrative fields are authority-only. Marine Regions and the atlas
        # identify a place; they are never promoted into synthetic history,
        # culture, ecology or oceanography prose.
        "historical_significance": [],
        "human_geography": [],
        "maritime_routes": [],
        "coastal_livelihoods": profile["coastal_livelihoods"] if has_offline_article else [],
        "marine_culture": [],
        "fact_sheet": [],
        "physical_geography": [],
        "oceanographic_processes": [],
        "ecosystems": [],
        "learning_prompts": [],
        "key_terms": profile["key_terms"],
        "references": references,
        "provider": (
            "百度百科简介"
            if use_baidu_baike and encyclopedia
            else "内置维基百科简体中文资料"
            if has_offline_article
            else "维基百科简体中文实时摘要"
            if live_article
            else ""
        ),
        "live_retrieved": baidu_article is not None or live_article is not None,
        "atlas_count": len(MARINE_ATLAS),
        "atlas_version": ATLAS_VERSION,
        "retrieved_at": datetime.now(UTC).isoformat(),
        "errors": [item for item in (context.get("place_error"),) if item],
        "caveats": [],
        "cache": {"state": "fresh", "age_seconds": 0.0, "ttl_seconds": KNOWLEDGE_CACHE_TTL_SECONDS},
    }
    result = normalize_text_fields(result)
    _validate_knowledge_payload(result)
    with _cache_lock:
        _cache[key] = (time.monotonic(), result)
        if len(_cache) > KNOWLEDGE_CACHE_MAX_ENTRIES:
            oldest = sorted(_cache, key=lambda item: _cache[item][0])[:-KNOWLEDGE_CACHE_MAX_ENTRIES]
            for old_key in oldest:
                _cache.pop(old_key, None)
    return result

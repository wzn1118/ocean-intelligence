import { readFileSync } from 'node:fs';

export function inspectReportQuality(htmlPath, markdownPath, minimumHeadings, minimumMarkdownBytes, minimumHtmlBytes, minimumHtmlFigures, minimumAnalyticalClaims, minimumComparisons, minimumEvidenceMarkers, requiredZoneCount, minimumChartTypes = 10) {
  let html = '';
  let markdown = '';
  try { html = readFileSync(htmlPath, 'utf8'); } catch { /* Missing artifacts are reported by the caller. */ }
  try { markdown = readFileSync(markdownPath, 'utf8'); } catch { /* Missing artifacts are reported by the caller. */ }
  const headingCount = (markdown.match(/^#{1,3}\s+\S+/gmu) || []).length;
  const figureCount = (html.match(/<(?:figure|img|svg)\b/giu) || []).length;
  const figureTags = html.match(/<figure\b[^>]*>/giu) || [];
  const chartTypes = figureTags.flatMap((tag) => tag.match(/data-chart-type=["']([^"']+)["']/iu)?.[1] || []).map((value) => value.trim().toLowerCase());
  const chartFamilies = figureTags.flatMap((tag) => tag.match(/data-chart-family=["']([^"']+)["']/iu)?.[1] || []).map((value) => value.trim().toLowerCase());
  const sourcedFigures = figureTags.filter((tag) => /data-source=["'][^"']+["']/iu.test(tag)).length;
  const figcaptionCount = (html.match(/<figcaption\b/giu) || []).length;
  const uniqueChartTypes = new Set(chartTypes).size;
  const familyCounts = Object.fromEntries(['spatial', 'temporal', 'profile', 'directional', 'distribution', 'coupling', 'uncertainty', 'physics', 'quality', 'impact'].map((family) => [family, chartFamilies.filter((value) => value === family).length]));
  const chartMetadataOk = figureTags.length >= minimumHtmlFigures
    && chartTypes.length >= minimumHtmlFigures
    && sourcedFigures >= minimumHtmlFigures
    && figcaptionCount >= minimumHtmlFigures;
  const chartDiversityOk = uniqueChartTypes >= minimumChartTypes;
  const scientificChartFamiliesOk = familyCounts.spatial >= 3
    && familyCounts.temporal >= 3
    && familyCounts.profile >= 2
    && familyCounts.directional >= 2
    && familyCounts.uncertainty >= 2
    && familyCounts.physics >= 3;
  const chartSemanticsOk = /(?:经度|longitude|纬度|latitude|深度|depth|时间|UTC)/iu.test(html)
    && /(?:m\/s|m s-1|°C|psu|g\/m|mg\/m|m²\/s|W\/m|单位|unit)/iu.test(html)
    && /(?:样本量|\bn\s*=|有效样本|缺测|QC|置信|不确定)/iu.test(html);
  const professionalVisualizationOk = chartMetadataOk && chartDiversityOk && scientificChartFamiliesOk && chartSemanticsOk;
  const figureIds = new Set(figureTags.flatMap((tag) => tag.match(/\bid=["']([^"']+)["']/iu)?.[1] || []));
  const interpretationBlocks = html.match(/<section\b[^>]*class=["'][^"']*\bfigure-interpretation\b[^"']*["'][^>]*>[\s\S]*?<\/section>/giu) || [];
  const completeInterpretationBlocks = interpretationBlocks.filter((block) => {
    const linkedId = block.match(/data-figure-id=["']([^"']+)["']/iu)?.[1];
    return Boolean(linkedId && figureIds.has(linkedId))
      && ['observation', 'physical-mechanism', 'operational-meaning', 'uncertainty', 'validation'].every((role) => new RegExp(`data-role=["']${role}["']`, 'iu').test(block));
  });
  const figureInterpretationOk = minimumHtmlFigures === 0 || (
    completeInterpretationBlocks.length >= minimumHtmlFigures
    && completeInterpretationBlocks.length >= figureTags.length
  );
  const editorialText = markdown
    .replace(/```[\s\S]*?```/gu, '')
    .replace(/`[^`]*`/gu, '')
    .split(/\r?\n/u)
    .filter((line) => !/^\s*>/u.test(line) && !/^\s*\|/u.test(line))
    .join('\n');
  const defensiveStylePatterns = [
    /不是[^。！？\n]{0,60}而是/gu,
    /并非[^。！？\n]{0,60}而是/gu,
    /不只是/gu,
    /不仅仅是/gu,
  ];
  const cannedTransitionPatterns = [
    /值得注意的是/gu,
    /需要注意的是/gu,
    /总体来看/gu,
    /综上所述/gu,
    /可以看出/gu,
    /由此可见/gu,
    /显而易见/gu,
    /根据上述分析/gu,
    /作为(?:AI|模型|人工智能)/giu,
  ];
  const defensiveStyleMatches = defensiveStylePatterns.flatMap((pattern) => editorialText.match(pattern) || []);
  const cannedTransitionMatches = cannedTransitionPatterns.flatMap((pattern) => editorialText.match(pattern) || []);
  const colloquialSingleVerbMatches = editorialText.match(/(?:^|[。！？；：，、\s])(?:看|说|做|找|查|算|画|用|给|让|把|去|搞)(?=(?:一下|一遍|这个|这些|数据|图表?|报告|结果|情况|问题|工具|模型|海域|点位|变量|出来|清楚|明白))/gmu) || [];
  const singleVerbHeadingMatches = editorialText.match(/^\s*(?:#{1,6}|[-*+]\s*)?\s*(?:看|说|做|找|查|算|画|用|给|让|把|去|搞)\s*$/gmu) || [];
  const editorialStyleViolations = [...defensiveStyleMatches, ...cannedTransitionMatches, ...colloquialSingleVerbMatches, ...singleVerbHeadingMatches];
  const editorialStyleOk = editorialStyleViolations.length === 0;
  const windWaveUnavailable = /(?:风场|波浪).{0,50}(?:未获取|无可用|无法获得|数据缺口)/u.test(markdown);
  const waveEnergySemanticsOk = windWaveUnavailable || (
    /(?:E\s*=\s*rho\s*g\s*Hs|E\s*=\s*ρ\s*g\s*H|波能密度).{0,80}(?:Hs\s*[²^]2?|有效波高的平方|平方关系)/iu.test(markdown)
    && /(?:波高变化|Hs变化).{0,120}(?:波能|能量).{0,40}(?:比例|变化|降幅|增幅)/u.test(markdown)
  );
  const crossVariableConsistencyOk = windWaveUnavailable || (
    /(?:跨变量一致性|风浪一致性|趋势背离|变化不同步|反向变化)/u.test(markdown)
    && /(?:共同时间窗|共同时间戳|时间对齐|重采样)/u.test(markdown)
    && /(?:有效风区|fetch|风向|方向夹角)/iu.test(markdown)
    && /(?:涌浪|源区|传播时间)/u.test(markdown)
    && /(?:滞后相关|响应时滞|lag)/iu.test(markdown)
    && /(?:候选机制|替代机制).{0,240}(?:验证|区分|判别)/u.test(markdown)
  );
  const operationalImpactOk = /(?:暴露).{0,160}(?:脆弱性).{0,160}(?:后果)/u.test(markdown.replace(/\s+/gu, ' '))
    && /(?:触发指标|触发条件)/u.test(markdown)
    && /(?:解除条件|结束条件)/u.test(markdown)
    && /(?:船型|作业方式|养殖设施|施工|港口|航线|生态受体|科研采样)/u.test(markdown)
    && /(?:条件性|情景条件|证据等级|空间边界)/u.test(markdown);
  const physicalRealityInterpretationOk = figureInterpretationOk && waveEnergySemanticsOk && crossVariableConsistencyOk && operationalImpactOk;
  const anomalyDataUnavailable = /(?:无可用|未获取|无法获得).{0,30}(?:异常候选|数值数据|点位数据)/u.test(markdown)
    && /(?:调用|尝试|工具|数据集).{0,100}(?:失败|缺口|未返回|不可用)/u.test(markdown);
  const anomalyRankingOk = anomalyDataUnavailable || (
    /异常点位(?:综合)?排行榜|异常候选排名/u.test(markdown)
    && /(?:前\s*10|Top\s*10|TOP\s*10)/iu.test(markdown)
    && /(?:正异常).{0,80}(?:负异常)/u.test(markdown)
    && /(?:稳健\s*Z|robust_z|百分位).{0,120}(?:持续时间|空间支持|空间连续)/iu.test(markdown)
    && /(?:权重|score_components|评分分量)/iu.test(markdown)
  );
  const zoneAnomalyCoverageOk = anomalyDataUnavailable || (
    /九区.{0,40}(?:异常|候选)/u.test(markdown)
    && countReportZones(markdown) >= requiredZoneCount
    && /(?:每区前\s*3|各区前\s*3|各区首名|逐区首名)/u.test(markdown)
  );
  const collocatedPointInventoryOk = anomalyDataUnavailable || (
    /(?:联动点位表|邻域观测清单|附近平台)/u.test(markdown)
    && /(?:平台ID|platform_id)/iu.test(markdown)
    && /(?:距离\s*km|distance_km|距离（km）)/iu.test(markdown)
    && /(?:时间差\s*h|time_difference_hours|时间差（h）)/iu.test(markdown)
    && /(?:深度差|depth_difference)/iu.test(markdown)
    && /L1.{0,80}L2.{0,80}L3.{0,80}L4.{0,80}L5/su.test(markdown)
  );
  const collocationMethodOk = anomalyDataUnavailable || (
    /(?:核心邻域|核心半径).{0,100}(?:局地邻域|局地半径).{0,100}(?:背景邻域|背景半径)/su.test(markdown)
    && /(?:时间容差|共同时间轴|共同时间戳)/u.test(markdown)
    && /(?:深度容差|深度差)/u.test(markdown)
    && /(?:网格对角线|产品分辨率|空间分辨率)/u.test(markdown)
  );
  const independentValidationOk = anomalyDataUnavailable || (
    /(?:独立验证|L1)/u.test(markdown)
    && /(?:同源|同一来源|来源独立性).{0,100}(?:不能|不得|不计|排除|资格)/u.test(markdown)
    && /(?:L1数量|L1点位|直接验证资格|无L1)/u.test(markdown)
  );
  const crossVariableMatrixOk = anomalyDataUnavailable || (
    /(?:跨变量联动矩阵|多变量联动矩阵)/u.test(markdown)
    && /(?:共同样本量|重叠样本数)/u.test(markdown)
    && /(?:相关系数|效应方向)/u.test(markdown)
    && /(?:滞后|lag)/iu.test(markdown)
    && /(?:方向夹角|来源关系)/u.test(markdown)
  );
  const lagAnalysisOk = anomalyDataUnavailable || (
    /ocean_statistical_diagnostics/iu.test(markdown)
    && /lag_correlation/iu.test(markdown)
    && /(?:最佳滞后|最大滞后)/u.test(markdown)
    && /(?:重叠样本数|共同样本量)/u.test(markdown)
    && /(?:自相关|多重检验)/u.test(markdown)
  );
  const falsificationPathOk = anomalyDataUnavailable || (
    /(?:可证伪条件|验证路径)/u.test(markdown)
    && /(?:支持|增强).{0,120}(?:削弱|否定)/u.test(markdown)
    && /(?:新增观测|补测|独立数据)/u.test(markdown)
  );
  const anomalyLinkageOk = anomalyRankingOk && zoneAnomalyCoverageOk && collocatedPointInventoryOk && collocationMethodOk && independentValidationOk && crossVariableMatrixOk && lagAnalysisOk && falsificationPathOk;
  const analyticalLines = markdown.split(/\r?\n/u).filter((line) => /(?:因为|因此|表明|相比|较|高于|低于|增加|减少|变化率|距平|异常|风险|机制|说明|意味着|可能导致|证据不足)/u.test(line) && /\d/u.test(line));
  const comparisonLines = markdown.split(/\r?\n/u).filter((line) => /(?:相比|较上|高于|低于|增加|减少|差异|变化|距平|倍|百分比|%|→)/u.test(line) && /\d/u.test(line));
  const evidenceMarkers = (markdown.match(/(?:E[1-6]|记录 ?ID|数据集|产品|来源|最新有效|QC|时间角色)/gu) || []).length;
  const zoneCoverage = countReportZones(markdown);
  const centerPointOk = /(?:分析中心点|研究区中心点|中心点)/u.test(markdown)
    && /(?:经度|°\s*[EW]|°\s*[东西])/iu.test(markdown)
    && /(?:纬度|°\s*[NS]|°\s*[南北])/iu.test(markdown);
  const geographyResolutionOk = /(?:ocean_resolve_marine_area|海域识别)/u.test(markdown)
    && /(?:selected_by|文本识别|点位识别|当前界面海域)/u.test(markdown)
    && /(?:geometry_status|几何状态)/u.test(markdown)
    && /(?:范围确定方式|范围来源|经纬度范围)/u.test(markdown)
    && /(?:中文名|英文规范名|英文名)/u.test(markdown);
  const pointSection = extractMarkdownSection(markdown, /Argo、浮标、岸基观测/u);
  const pointZoneCoverage = countReportZones(pointSection);
  const pointInventoryOk = /(?:点位总数|点位数量|九区点位)/u.test(pointSection)
    && /(?:原始记录数|原始记录)/u.test(pointSection)
    && /(?:有效记录数|有效记录)/u.test(pointSection)
    && /(?:独立平台数|独立点位|平台数)/u.test(pointSection)
    && /(?:点位密度|覆盖密度)/u.test(pointSection)
    && /(?:QC|质量控制)/iu.test(pointSection)
    && /(?:最新观测时间|时间延迟|数据时效)/u.test(pointSection);
  const pointAuditOk = /(?:未归区|坐标缺失|坐标无效|研究区外|区外记录)/u.test(pointSection)
    && /(?:重复平台|去重)/u.test(pointSection)
    && /(?:QC失败|质量控制失败|未通过QC)/iu.test(pointSection)
    && /(?:未知|未获取).{0,40}(?:0|零)|(?:0|零).{0,40}(?:未知|未获取)/u.test(pointSection);
  const windSection = extractMarkdownSection(markdown, /(?:^|\s|[.、])风场(?:分析|专题|\s|$)/u);
  const windUnavailable = /(?:当前未获得|未获取|无可用).{0,20}(?:风场|风速|风数据)/u.test(windSection)
    && /(?:原因|失败|缺口|限制)/u.test(windSection);
  const windTimeSemanticsOk = windUnavailable || (
    /(?:请求窗口|requested window|requested_start|requested_end)/iu.test(windSection)
    && /(?:有效窗口|effective window|effective_start|effective_end|latest_valid_time)/iu.test(windSection)
    && /(?:时间戳|时次数)/u.test(windSection)
    && /(?:24个小时区间|24小时跨度|时间加权)/u.test(windSection)
    && /(?:数据延迟|data_latency)/iu.test(windSection)
  );
  const windVectorSemanticsOk = windUnavailable || (
    /eastward_wind/iu.test(windSection)
    && /northward_wind/iu.test(windSection)
    && /wind_speed/iu.test(windSection)
    && /(?:wind_direction_from|气象学来向)/iu.test(windSection)
    && /(?:风矢量数|有效矢量数)/u.test(windSection)
    && /(?:分量值数|分量数量)/u.test(windSection)
    && /(?:方向一致性|\bR\s*=)/iu.test(windSection)
  );
  const windSpatialMethodOk = windUnavailable || (
    countReportZones(windSection) >= requiredZoneCount
    && /(?:海陆掩膜|陆地掩膜|产品自身掩膜)/u.test(windSection)
    && /(?:持续零值|零值审计|零值掩膜)/u.test(windSection)
    && /(?:有效覆盖率|有效海洋格点)/u.test(windSection)
    && /(?:面积加权|cos\s*\(?latitude|未进行面积加权)/iu.test(windSection)
  );
  const windComparisonOk = windUnavailable || /(?:前一个等长24小时|前一(?:个)?24小时|前一窗口|历史基线|气候态).{0,80}(?:比较|变化|不可用|无法)/u.test(windSection);
  const windPointValidationOk = windUnavailable || (
    /(?:原位风|点位风速|风相关.*点位)/u.test(windSection)
    && /(?:独立平台数|独立平台|点位数量)/u.test(windSection)
    && /(?:独立验证|同期点位|当前没有同期)/u.test(windSection)
  );
  const variableSectionChecks = {
    seaSurfaceTemperature: inspectVariableSection(markdown, /海表温度/u, /(?:海表温度|SST|温度)/iu, requiredZoneCount, [
      /(?:skin|sub-skin|foundation|bulk|表皮温度|基础温度|体温度|指定深度)/iu,
      /(?:°C|摄氏|开尔文|kelvin|\bK\b)/iu,
      /(?:请求窗口|请求范围|实际有效|有效窗口|latest_valid_time)/iu,
      /(?:有效值数|有效像元|有效覆盖率).{0,60}(?:缺测|掩膜|云|陆地|海冰)/u,
      /(?:面积加权|cos\s*\(?latitude|等权网格平均)/iu,
      /(?:前一窗口|前一个等长|历史基线|气候态).{0,80}(?:比较|变化|不可用|无法)/u,
      /(?:原位温度|浮标|Argo|同期点位).{0,80}(?:验证|平台数|不可用|没有同期)/u,
    ]),
    salinityStructure: inspectVariableSection(markdown, /盐度与温盐结构/u, /(?:盐度|温盐|剖面)/u, requiredZoneCount, [
      /(?:Practical Salinity|PSS-78|Absolute Salinity|实用盐度|绝对盐度)/iu,
      /(?:剖面数|有效剖面|独立平台数).{0,80}(?:有效层数|深度范围|最大观测深度|垂向分辨率)/u,
      /(?:混合层|温跃层|盐跃层).{0,80}(?:判据|阈值|参考深度|不可计算)/u,
      /(?:T-S|温盐关系|TEOS-10|GSW|密度)/iu,
      /(?:QC|质量控制)/iu,
      /(?:前一窗口|历史基线|气候态).{0,80}(?:比较|变化|不可用|无法)/u,
      /(?:九区剖面覆盖|各区剖面|点位覆盖|同期点位).{0,80}(?:验证|缺口|平台数|不可用)/u,
    ]),
    surfaceCurrent: inspectVariableSection(markdown, /表层流/u, /(?:表层流|海流|流速)/u, requiredZoneCount, [
      /(?:eastward|northward|\bu\b|\bv\b|东向流|北向流)/iu,
      /(?:标量平均流速|合成平均矢量流速|流向|海洋学.*去向)/u,
      /(?:流矢量数|有效矢量数).{0,80}(?:分量值数|分量数量)/u,
      /(?:方向一致性|\bR\s*=)/iu,
      /(?:代表深度|层厚|总流|地转流|潮流|Ekman)/iu,
      /(?:海陆掩膜|静态零值|零值审计).{0,80}(?:有效覆盖率|面积加权|等权网格平均)/u,
      /(?:前一窗口|前一个等长|历史基线).{0,80}(?:比较|变化|不可用|无法)/u,
      /(?:原位流|ADCP|漂流浮标|同期点位).{0,80}(?:验证|平台数|不可用|没有同期)/iu,
    ]),
    waves: inspectVariableSection(markdown, /总浪、涌浪、风浪/u, /(?:总浪|涌浪|风浪|波浪)/u, requiredZoneCount, [
      /(?:总浪).{0,80}(?:涌浪).{0,80}(?:风浪)/u,
      /(?:有效波高|\bHs\b).{0,80}(?:峰值周期|平均周期|波向|来向)/iu,
      /(?:分析|再分析|预报).{0,80}(?:有效时间|forecast lead time|预报时效)/iu,
      /(?:不能|不得|并非).{0,50}(?:线性相加|Hs_total|有效波高相加)/iu,
      /(?:陆地|静态零值|零值审计|近岸分辨率).{0,80}(?:覆盖率|掩膜|遮蔽)/u,
      /(?:前一窗口|前一个等长|历史基线).{0,80}(?:比较|变化|不可用|无法)/u,
      /(?:波浪浮标|浮标验证|同期点位).{0,80}(?:验证|平台数|不可用|没有同期)/u,
    ]),
    ecology: inspectVariableSection(markdown, /叶绿素与生态指标/u, /(?:叶绿素|生态指标|chlorophyll)/iu, requiredZoneCount, [
      /(?:mg\/?m\^?3|mg\/m³|毫克每立方米|单位)/iu,
      /(?:中位数|P05|P95|四分位数|几何均值|log10)/iu,
      /(?:云|太阳耀斑|浑浊|近岸光学|质量标记).{0,80}(?:有效像元|覆盖率|掩膜|QC)/u,
      /(?:负值|零值).{0,80}(?:审计|掩膜|未知|缺测)/u,
      /(?:前一窗口|季节基线|气候态|历史基线).{0,80}(?:比较|变化|不可用|无法)/u,
      /(?:现场采样|原位叶绿素|同期点位).{0,80}(?:验证|平台数|不可用|没有同期)/u,
      /(?:不能|不得|不等同).{0,50}(?:藻华|赤潮|富营养化|渔获)/u,
    ]),
    coupling: inspectVariableSection(markdown, /风浪流耦合/u, /(?:风浪流|耦合)/u, requiredZoneCount, [
      /(?:共同覆盖|空间对齐|网格对齐).{0,80}(?:共同时间戳|时间对齐|匹配样本数)/u,
      /(?:风.?流夹角|风.?浪夹角|流.?浪夹角|方向差)/u,
      /(?:滞后相关|相关系数|敏感性|无法计算相关)/u,
      /(?:因果|耦合线索|替代解释).{0,100}(?:潮汐|岸线|径流|涌浪|同源误差)/u,
    ]),
    anomalyCandidates: inspectVariableSection(markdown, /异常候选/u, /(?:异常候选|异常)/u, requiredZoneCount, [
      /(?:阈值).{0,80}(?:基线|距平|百分位)/u,
      /(?:首次|末次|持续性|持续时间)/u,
      /(?:空间连续性|空间连通|涉及九区|支持网格)/u,
      /(?:独立验证|证据等级)/u,
      /(?:候选|未确认|不是官方预警|不得称确认)/u,
    ]),
    dataQuality: inspectVariableSection(markdown, /数据时效、缺口和质量/u, /(?:数据时效|缺口|质量)/u, 0, [
      /(?:latest_valid_time|最新有效时间).{0,100}(?:fetch_time|抓取时间|生成时间)/iu,
      /(?:latency|数据延迟)/iu,
      /(?:请求分辨率|实际分辨率|空间分辨率|时间分辨率|深度分辨率)/u,
      /(?:覆盖率|缺测|QC通过率|质量控制)/iu,
      /(?:缓存|失败调用|重试|抽样策略)/u,
      /(?:结论影响|影响哪些结论|结论敏感性|能力边界)/u,
    ]),
  };
  const variableSectionsOk = Object.values(variableSectionChecks).every(Boolean);
  const physicalSection = extractMarkdownSection(markdown, /物理机制诊断/u);
  const normalizedPhysicalSection = physicalSection.replace(/\s+/gu, ' ');
  const physicalRotationOk = /ocean_physics_diagnostics/u.test(normalizedPhysicalSection)
    && /(?:科氏参数|coriolis|\bf\s*=)/iu.test(normalizedPhysicalSection)
    && /(?:beta|β)/iu.test(normalizedPhysicalSection)
    && /(?:惯性周期|inertial period)/iu.test(normalizedPhysicalSection);
  const physicalScaleAnalysisOk = /(?:U.?L.?H.?T|速度尺度).{0,120}(?:水平尺度|垂向尺度).{0,120}(?:时间尺度)/iu.test(normalizedPhysicalSection)
    && /(?:Rossby|\bRo\b)/iu.test(normalizedPhysicalSection)
    && /(?:Froude|Burger|变形半径|输入不足.{0,40}(?:N|垂向尺度|约化重力))/iu.test(normalizedPhysicalSection);
  const physicalBalanceOk = /(?:水平动量方程|动量收支|主导平衡)/u.test(normalizedPhysicalSection)
    && /(?:局地加速度|平流).{0,120}(?:科氏|压力梯度).{0,120}(?:风应力|摩擦|混合)/u.test(normalizedPhysicalSection)
    && /(?:量级排序|项量级|主导项)/u.test(normalizedPhysicalSection)
    && /(?:替代机制|替代解释).{0,120}(?:潮汐|径流|岸线|混合|涌浪|底摩擦)/u.test(normalizedPhysicalSection);
  const physicalProvenanceOk = /(?:输入来源|输入证据).{0,160}(?:数据集|产品|记录 ID|变量)/u.test(normalizedPhysicalSection)
    && /(?:方程|公式).{0,120}(?:单位|量纲)/u.test(normalizedPhysicalSection)
    && /(?:适用条件|假设).{0,120}(?:失效条件|不适用|限制)/u.test(normalizedPhysicalSection);
  const physicalZoneRegimeOk = countReportZones(physicalSection) >= requiredZoneCount
    && /(?:九区物理机制|物理机制分型|九区动力)/u.test(normalizedPhysicalSection)
    && /(?:差异|不同|分型|主导)/u.test(normalizedPhysicalSection);
  const physicalUncertaintyOk = /(?:敏感性分析|敏感性检验)/u.test(normalizedPhysicalSection)
    && /(?:不确定度|误差传播)/u.test(normalizedPhysicalSection)
    && /(?:可证伪|削弱或否定|否定该解释)/u.test(normalizedPhysicalSection);
  const textbookReferences = normalizedPhysicalSection.match(/\[?Stewart\s*2008[^\]\n。；;]{0,120}(?:Ch\.|Chapter|第\s*\d+\s*章)[^\]\n。；;]{0,120}(?:pp\.|教材页码|textbook pp\.)[^\]\n。；;]{0,40}\]?/giu) || [];
  const textbookReferenceOk = new Set(textbookReferences.map((value) => value.toLowerCase())).size >= 3
    && /(?:教材|理论依据).{0,80}(?:不是|不作为|区别于).{0,80}(?:当前海况证据|数据证据|观测证据)/u.test(normalizedPhysicalSection);
  const physicalOceanographyOk = physicalRotationOk
    && physicalScaleAnalysisOk
    && physicalBalanceOk
    && physicalProvenanceOk
    && physicalZoneRegimeOk
    && physicalUncertaintyOk
    && textbookReferenceOk;
  return {
    markdownBytes: Buffer.byteLength(markdown, 'utf8'),
    htmlBytes: Buffer.byteLength(html, 'utf8'),
    headingCount,
    figureCount,
    figureTagCount: figureTags.length,
    figcaptionCount,
    uniqueChartTypes,
    chartTypes: [...new Set(chartTypes)].sort(),
    chartFamilyCounts: familyCounts,
    sourcedFigures,
    chartMetadataOk,
    chartDiversityOk,
    scientificChartFamiliesOk,
    chartSemanticsOk,
    professionalVisualizationOk,
    figureInterpretationCount: interpretationBlocks.length,
    completeFigureInterpretationCount: completeInterpretationBlocks.length,
    figureInterpretationOk,
    waveEnergySemanticsOk,
    crossVariableConsistencyOk,
    operationalImpactOk,
    physicalRealityInterpretationOk,
    anomalyRankingOk,
    zoneAnomalyCoverageOk,
    collocatedPointInventoryOk,
    collocationMethodOk,
    independentValidationOk,
    crossVariableMatrixOk,
    lagAnalysisOk,
    falsificationPathOk,
    anomalyLinkageOk,
    editorialStyleOk,
    editorialStyleViolationCount: editorialStyleViolations.length,
    defensiveStyleMatches: [...new Set(defensiveStyleMatches)].slice(0, 10),
    cannedTransitionMatches: [...new Set(cannedTransitionMatches)].slice(0, 10),
    colloquialSingleVerbMatches: [...new Set([...colloquialSingleVerbMatches, ...singleVerbHeadingMatches].map((value) => value.trim()))].slice(0, 10),
    analyticalClaims: new Set(analyticalLines).size,
    comparisons: new Set(comparisonLines).size,
    evidenceMarkers,
    zoneCoverage,
    centerPointOk,
    geographyResolutionOk,
    pointZoneCoverage,
    pointInventoryOk,
    pointAuditOk,
    windTimeSemanticsOk,
    windVectorSemanticsOk,
    windSpatialMethodOk,
    windComparisonOk,
    windPointValidationOk,
    variableSectionChecks,
    variableSectionsOk,
    physicalRotationOk,
    physicalScaleAnalysisOk,
    physicalBalanceOk,
    physicalProvenanceOk,
    physicalZoneRegimeOk,
    physicalUncertaintyOk,
    textbookReferenceOk,
    physicalOceanographyOk,
    markdownBytesOk: Buffer.byteLength(markdown, 'utf8') >= minimumMarkdownBytes,
    htmlBytesOk: Buffer.byteLength(html, 'utf8') >= minimumHtmlBytes,
    headingCountOk: headingCount >= minimumHeadings,
    figureCountOk: figureCount >= minimumHtmlFigures,
    analyticalClaimsOk: new Set(analyticalLines).size >= minimumAnalyticalClaims,
    comparisonsOk: new Set(comparisonLines).size >= minimumComparisons,
    evidenceMarkersOk: evidenceMarkers >= minimumEvidenceMarkers,
    zoneCoverageOk: zoneCoverage >= requiredZoneCount,
    pointZoneCoverageOk: pointZoneCoverage >= requiredZoneCount,
  };
}

function extractMarkdownSection(markdown, titlePattern) {
  const lines = markdown.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^#{1,3}\s+/u.test(line) && titlePattern.test(line));
  if (start < 0) return '';
  const startLevel = lines[start].match(/^(#{1,3})\s+/u)?.[1].length || 3;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{1,3})\s+/u);
    if (heading && heading[1].length <= startLevel) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function inspectVariableSection(markdown, titlePattern, unavailableSubjectPattern, requiredZoneCount, requiredPatterns) {
  const section = extractMarkdownSection(markdown, titlePattern);
  const normalized = section.replace(/\s+/gu, ' ');
  const unavailable = /(?:当前未获得|未获取|无可用|无法获得)/u.test(normalized)
    && unavailableSubjectPattern.test(normalized)
    && /(?:原因|失败|缺口|限制|未返回|不可用)/u.test(normalized)
    && /(?:尝试|数据集|工具|调用|所需数据|下一步)/u.test(normalized);
  if (unavailable) return true;
  return section.length > 0
    && (requiredZoneCount === 0 || countReportZones(section) >= requiredZoneCount)
    && requiredPatterns.every((pattern) => pattern.test(normalized));
}

function countReportZones(text) {
  const multiCharacterZones = ['西北', '北', '东北', '中间', '西南', '南', '东南'];
  return multiCharacterZones.filter((zone) => text.includes(zone)).length
    + Number(/(?:^|[|｜,，、；;:\s])西(?:[|｜,，、；;:\s]|$)/mu.test(text))
    + Number(/(?:^|[|｜,，、；;:\s])东(?:[|｜,，、；;:\s]|$)/mu.test(text));
}

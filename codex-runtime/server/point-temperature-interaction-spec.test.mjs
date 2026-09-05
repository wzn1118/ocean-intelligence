import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POINT_TEMPERATURE_INTERACTION_SPEC,
  POINT_TEMPERATURE_TOOLTIP_FIELDS,
  pointTemperatureInteractionInstructions,
} from './point-temperature-interaction-spec.mjs';

test('requires hover and focus tooltips for every enumerable temperature point', () => {
  assert.match(POINT_TEMPERATURE_INTERACTION_SPEC, /所有可枚举温度点都必须同时支持鼠标 hover 和键盘 focus/u);
  assert.match(POINT_TEMPERATURE_INTERACTION_SPEC, /覆盖全部可枚举温度点/u);
  assert.match(POINT_TEMPERATURE_INTERACTION_SPEC, /每一点均可通过 hover 和 focus 打开提示/u);
});

test('defines every required point-temperature tooltip field', () => {
  assert.deepEqual(POINT_TEMPERATURE_TOOLTIP_FIELDS, [
    '点位标识或名称',
    '温度值与温度单位',
    '观测或有效时间',
    '经度与纬度',
    'QC 状态或质量标志',
  ]);
  assert.equal(Object.isFrozen(POINT_TEMPERATURE_TOOLTIP_FIELDS), true);

  for (const field of POINT_TEMPERATURE_TOOLTIP_FIELDS) {
    assert.match(POINT_TEMPERATURE_INTERACTION_SPEC, new RegExp(field, 'u'));
  }
  assert.match(POINT_TEMPERATURE_INTERACTION_SPEC, /时间必须包含时区或明确标注 UTC/u);
  assert.match(POINT_TEMPERATURE_INTERACTION_SPEC, /非空且全局唯一的稳定 ObservationID/u);
  assert.match(POINT_TEMPERATURE_INTERACTION_SPEC, /data-point-index 和对应 data-observation-id/u);
});

test('preserves identity through ordering and owns callback cleanup', () => {
  assert.match(POINT_TEMPERATURE_INTERACTION_SPEC, /过滤或排序只能改变显示顺序，不得重建 ObservationID/u);
  assert.match(POINT_TEMPERATURE_INTERACTION_SPEC, /变换前保存 SourceRow 或等价源键/u);
  assert.match(POINT_TEMPERATURE_INTERACTION_SPEC, /不得以注释、说明字符串、全局未绑定处理器或静态标签冒充/u);
  assert.match(POINT_TEMPERATURE_INTERACTION_SPEC, /关闭、句柄删除及异常退出必须安全清理/u);
  assert.match(POINT_TEMPERATURE_INTERACTION_SPEC, /静态成功不能声明桌面 DataTip、Brush 或回调已验证/u);
});

test('requires legends for all multi-series charts', () => {
  assert.match(POINT_TEMPERATURE_INTERACTION_SPEC, /所有包含两个及以上数据系列的图必须提供图例/u);
  assert.match(POINT_TEMPERATURE_INTERACTION_SPEC, /静态与交互版本中的系列名称、顺序和编码必须一致/u);
});

test('requires a self-contained interactive HTML alongside static exports', () => {
  assert.match(POINT_TEMPERATURE_INTERACTION_SPEC, /在交付静态 PNG 和\/或 PDF 之外，必须同时交付一个自包含交互 HTML/u);
  assert.match(POINT_TEMPERATURE_INTERACTION_SPEC, /离线打开即可使用/u);
  assert.match(POINT_TEMPERATURE_INTERACTION_SPEC, /不得依赖 CDN、远程接口、本机服务、外部 JavaScript\/CSS 文件或绝对文件路径/u);
});

test('exposes deterministic side-effect-free integration instructions', () => {
  assert.equal(pointTemperatureInteractionInstructions(), POINT_TEMPERATURE_INTERACTION_SPEC);
  assert.equal(pointTemperatureInteractionInstructions(), pointTemperatureInteractionInstructions());
});

import type { ImageAngle } from "./types";

export const defaultImageAngle: ImageAngle = { azimuth: 0, elevation: 0, zoom: 5, lens: "standard" };
export const anglePresets: { name: string; value: ImageAngle; prompt?: string }[] = [
  { name: "鱼眼视角", value: { azimuth: 0, elevation: 30, zoom: 10, lens: "standard" }, prompt: "极度特写镜头，广角镜头，边缘带有鱼眼畸变效果" },
  { name: "倾斜视角", value: { azimuth: 45, elevation: -30, zoom: 5, lens: "standard" }, prompt: "dutch angle，tilted frame" },
  { name: "向上俯拍", value: { azimuth: 0, elevation: 45, zoom: 5, lens: "standard" } },
  { name: "向下仰拍", value: { azimuth: 0, elevation: -30, zoom: 5, lens: "standard" } },
  { name: "全景俯拍", value: { azimuth: 0, elevation: 60, zoom: 1, lens: "standard" } },
  { name: "反向视角", value: { azimuth: 180, elevation: 0, zoom: 5, lens: "standard" } },
];
export function normalizeImageAngle(value: ImageAngle): ImageAngle {
  return {
    azimuth: ((Math.round(value.azimuth) % 360) + 360) % 360,
    elevation: Math.max(-90, Math.min(90, Math.round(value.elevation))),
    zoom: Math.max(0, Math.min(10, Math.round(value.zoom * 10) / 10)),
    lens: value.lens || "standard",
  };
}
/** Relative subject size: 5 preserves the reference framing; endpoints halve/double it. */
export function imageAngleFramingScale(value: ImageAngle) {
  return 2 ** ((normalizeImageAngle(value).zoom - 5) / 5);
}

export function imageAngleDescription(value: ImageAngle) {
  const angle = normalizeImageAngle(value);
  const horizontal = angle.azimuth > 180 ? angle.azimuth - 360 : angle.azimuth;
  return {
    direction: horizontal === 0 ? "保持原图水平方向" : Math.abs(horizontal) === 180
      ? "相对原图反向环绕 180°"
      : `相对原图向${horizontal > 0 ? "右" : "左"}环绕 ${Math.abs(horizontal)}°`,
    elevation: angle.elevation === 0 ? "保持原图俯仰角度"
      : `相对原图向${angle.elevation > 0 ? "上" : "下"}环绕 ${Math.abs(angle.elevation)}°，${angle.elevation > 0 ? "抬高机位俯拍" : "降低机位仰拍"}`,
    distance: angle.zoom === 5 ? "原图景别" : angle.zoom < 5 ? "拉远" : "拉近",
  };
}
export function imageAnglePrompt(value: ImageAngle) {
  const angle = normalizeImageAngle(value);
  const description = imageAngleDescription(angle);
  const scale = imageAngleFramingScale(angle).toFixed(2);
  const framing = angle.zoom === 5 ? "保持主体在原图中的画面占比，不自动改成中景、近景或特写。"
    : `相对原图${description.distance}取景，使主体画面占比约为原图的 ${scale} 倍；只改变取景距离，不缩放主体本身。`;
  return `以参考图片当前拍摄视角为唯一零点，重新拍摄同一主体。原图可能已经是侧面、背面或俯仰视角，不要先把它校正成产品正面或水平视角。
水平环绕 ${angle.azimuth}°：${description.direction}。左右以原图观看者的画面方向为准，向右表示相机移向原图画面右侧，向左表示相机移向原图画面左侧，不使用主体自身的左右定义；180°表示相对原图的另一侧，不能一律理解成产品背面。主体保持原来的朝向和姿态。
俯仰 ${angle.elevation}°：${description.elevation}。这是相对原图拍摄仰角的变化量；相机始终朝向主体中心，不是让主体低头、抬头或倾斜，不能用画面旋转代替俯仰变化。
景别缩放 ${angle.zoom.toFixed(1)}/10：${framing}刻度 0 为原图占比的 0.50 倍，5 为原图占比的 1.00 倍，10 为原图占比的 2.00 倍，中间连续变化。
${angle.lens === "fisheye" ? "使用鱼眼镜头投影，允许真实广角光学畸变，但不改变主体实际结构。" : "默认保持原图镜头透视；正文明确指定鱼眼、广角等镜头效果时按正文执行，光学畸变不改变主体实际结构。"}正文指定倾斜构图（dutch angle / tilted frame）时，在完成相机环绕后叠加相机滚转；不能用平面旋转、镜像、拉伸或仅裁切原图代替相机环绕。
水平和俯仰都是相对原图的独立角度偏移，必须同时执行所选数值，不要取整为 45°、90°等固定预设；两项均为 0°时保留原图观察方向。
仅移动相机并调整取景，保持主体身份、产品结构、材质、人物姿态及场景物体位置一致；背景透视和遮挡随新机位合理变化。依据原图补全新视角可见结构，不添加拼版、文字或重复主体。观察方向和取景以本段为准，不被正文或风格预设中的原构图要求覆盖。`;
}

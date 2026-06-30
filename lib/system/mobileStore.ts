export const MOBILE_STORE_CLOUD_PC = {
  slug: "tianyiyun-cloud-pc",
  title: "天翼云训练云电脑",
  subtitle: "30 天训练云电脑",
  price: "204",
  priceUnit: "元 / 30 天",
  image: "/system/store/cloud-pc-hero.svg",
  notes: [
    "购买后不支持退款。",
    "请假、个人行程或其他个人原因导致的时间损耗，由购买人自行承担。",
    "单个学员最多可购买两次。",
    "下单前请先确认自己的训练周期和使用安排。"
  ],
  wechatPayUrl: process.env.NEXT_PUBLIC_STORE_CLOUD_PC_WECHAT_URL || "",
  alipayUrl: process.env.NEXT_PUBLIC_STORE_CLOUD_PC_ALIPAY_URL || ""
} as const;

<script setup lang="ts">
const experiments = [
  ['离线 OCR 引擎', '将以独立下载包、SHA-256 校验和许可证清单接入。当前未安装，不会写入任何识别结果。', '引擎准备中'],
  ['公式识别', '会通过用户确认的视觉 API 生成 LaTeX 草稿；不会自动把图片发送到网络。', '接口设计中'],
  ['滚动截图', '桌面捕获、拼接与标注将作为独立工具包开发。', '原型规划中'],
  ['音视频工具', '抽帧、转写和字幕处理将在文件中心稳定后加入。', '排期未定']
]
</script>

<template>
  <div class="lab-page page-enter">
    <section class="page-heading"><div><p class="eyebrow">TOOLKNIT LAB</p><h2>先把边界讲清楚，<em>再把能力做扎实。</em></h2><p>实验室展示正在设计的工作流，不保存任务结果，也不会伪造“已完成”。</p></div></section>
    <section class="lab-grid"><article v-for="item in experiments" :key="item[0]" class="lab-card"><span>实验功能</span><h3>{{ item[0] }}</h3><p>{{ item[1] }}</p><footer><i></i>{{ item[2] }}</footer></article></section>
  </div>
</template>

<script setup lang="ts">
// Embedded reader = MejiroReader inside a constrained box on a normal page,
// not full-screen. The reader fills whatever container you give it; here we
// wrap it in a fixed-height card alongside other article content.
import '@libraz/mejiro/render/mejiro-fonts.css';
import { MejiroReader } from '@libraz/mejiro-vue';
</script>

<template>
  <article class="page">
    <header class="page-head">
      <span class="kicker">Sample article</span>
      <h1>『吾輩は猫である』を読む</h1>
      <p class="byline">夏目漱石 / 1905</p>
    </header>

    <p>
      下のリーダーは <code>MejiroReader</code> をページ内に埋め込んだものです。
      コンテナにサイズを与えれば、フルスクリーンでなくても同じUIが動きます。
    </p>

    <div class="reader-frame">
      <MejiroReader
        epub-url="/neko.epub"
        :enable-drop-zone="false"
        :enable-stats="false"
        :enable-settings="false"
        subtitle=""
      />
    </div>

    <p>
      <strong>ポイント</strong>: <code>.mejiro-reader</code> は親要素の幅×高さを
      使い切ります。親に <code>height</code> と <code>width</code> を与えれば
      埋め込みリーダーの寸法はそのまま決まります。
    </p>
  </article>
</template>

<style scoped>
.page {
  max-width: 720px;
  margin: 0 auto;
  padding: 56px 28px 96px;
  font-size: 0.95rem;
  line-height: 1.75;
}

.page-head {
  margin-bottom: 32px;
  text-align: center;
}

.kicker {
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #8b3a3a;
}

.page-head h1 {
  margin: 8px 0 6px;
  font-family: 'Shippori Mincho', 'Noto Serif JP', serif;
  font-weight: 500;
  font-size: 1.8rem;
}

.byline {
  margin: 0;
  font-size: 0.78rem;
  color: #6b6156;
}

p {
  margin: 0 0 18px;
}

code {
  font-size: 0.85em;
  background: rgba(0, 0, 0, 0.06);
  padding: 0 4px;
  border-radius: 2px;
}

.reader-frame {
  height: 560px;
  margin: 28px 0;
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.14);
  overflow: hidden;
}
</style>

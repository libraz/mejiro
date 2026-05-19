// Embedded reader = MejiroReader inside a constrained box on a normal page,
// not full-screen. The reader fills whatever container you give it; here we
// wrap it in a fixed-height card alongside other article content.
import '@libraz/mejiro/render/mejiro-fonts.css';
import { MejiroReader } from '@libraz/mejiro-react';
import './styles.css';

export default function App() {
  return (
    <article className="page">
      <header className="page-head">
        <span className="kicker">Sample article</span>
        <h1>『吾輩は猫である』を読む</h1>
        <p className="byline">夏目漱石 / 1905</p>
      </header>

      <p>
        下のリーダーは <code>MejiroReader</code> をページ内に埋め込んだものです。
        コンテナにサイズを与えれば、フルスクリーンでなくても同じUIが動きます。
      </p>

      <div className="reader-frame">
        <MejiroReader
          epubUrl="/neko.epub"
          enableDropZone={false}
          enableStats={false}
          enableSettings={false}
          subtitle=""
        />
      </div>

      <p>
        <strong>ポイント</strong>: <code>.mejiro-reader</code> は親要素の幅×高さを
        使い切ります。親に <code>height</code> と <code>width</code> を与えれば
        埋め込みリーダーの寸法はそのまま決まります。
      </p>
    </article>
  );
}

/**
 * Deterministic Japanese prose corpus for the analysis benchmark.
 *
 * The text is built in-process rather than fetched, so the benchmark runs
 * offline and always measures the same input. The sentence pool is written to
 * cover the constructs the typography hints actually react to, in roughly the
 * proportions of ordinary body text:
 *
 * - narrative prose (40 sentences) — the bulk of any chapter, and the case where
 *   the hints have the least to say. About one in four opens with a conjunction,
 *   which is what ordinary narrative does and what puts a closed-class
 *   independent word at the head of a line;
 * - numerals with counters (10) — `12人`, `18時30分`, `第3章`, `4800円`, the units
 *   the cluster rules bind together;
 * - prefixed words (8) — `お名前`, `ご案内`, `未確認`, `不用意`, which the prefix rule
 *   binds rightwards;
 * - Latin runs inside Japanese (8) — `TypeScript`, `WebAssembly`, `EPUB`, `API`,
 *   the runs that the full-width break rules would otherwise cut anywhere;
 * - dialogue and heavy punctuation (8) — quotes, dashes and small kana, which is
 *   what forces the kinsoku backtracking the cost search rides on.
 *
 * A paragraph mixes the categories in a fixed cycle, so the ratio above holds
 * for any requested length.
 */

/** Ordinary narrative, the bulk of a chapter. */
const NARRATIVE: readonly string[] = [
  '夜が明ける前の街はまだ静かで、遠くを走る電車の音だけが低く響いていた。',
  '彼女は窓辺に立ち、薄い霧の向こうに沈んでいく灯りをただ眺めていた。',
  '部屋の隅に積まれた本の背表紙が、机の明かりを受けて鈍く光っている。',
  '何かを言いかけて、そのまま黙ってしまう癖は昔から変わっていなかった。',
  '廊下を歩く足音が近づき、扉の前で止まり、それきり動かなくなった。',
  '春先の風は思いのほか冷たく、袖口から入り込んでは首筋を撫でていく。',
  '約束の場所に着いたときには、空はすでに藍色に沈みかけていた。',
  '手紙の文字は震えていて、書いた者の迷いがそのまま残っているようだった。',
  '誰も来ないと分かっていながら、それでも彼は座り続けるつもりでいた。',
  '川沿いの道を選んだのは、遠回りになると知っていたからにほかならない。',
  '記憶というものは、都合のいいところだけを鮮やかに残していくものらしい。',
  '会議が終わったあとの部屋には、冷めた珈琲の匂いだけが残っていた。',
  'しかし、その夜だけは灯りを落とさず、彼は机の前に座り続けていた。',
  '駅前の古い時計は少し進んでいて、待ち合わせの相手はいつも先に着いていた。',
  '雨上がりの舗道に映った看板の色が、通り過ぎる車のたびに揺れて崩れた。',
  'だから、返事を書かないという選び方も、彼女なりの答えではあったのだろう。',
  '台所の窓から差す光が、床に細長い線を引いて少しずつ動いていった。',
  '長い坂を上りきったところで振り返ると、街はもう霞んで見えなかった。',
  'そして誰もいなくなった廊下に、雨の音だけが規則正しく響いていた。',
  '本を閉じる音がやけに大きく聞こえて、彼はそっと肩をすくめた。',
  '夏の終わりの空気には、どこか焦げたような匂いが混じっている。',
  'けれども、その約束が果たされることは、とうとう一度もなかった。',
  '古い写真の裏には、色あせた文字で日付だけが書き添えられていた。',
  '電話を切ったあとも、彼女はしばらく受話器を握ったままでいた。',
  'ところが、扉を開けた先に広がっていたのは、見覚えのない中庭だった。',
  '庭の隅に置き忘れられた椅子が、雪を載せたまま冬を越していた。',
  '人の少ない車両で、彼は膝の上の鞄をずっと抱え直していた。',
  'つまり、彼が黙っていた理由は、最初から一つしかなかったのだ。',
  '棚の奥から出てきた鍵は、どの扉にも合わないまま机に残された。',
  '夕方の教室には、日誌を書く鉛筆の音だけが細く続いていた。',
  'したがって、残された時間で確かめられることは、ほとんど何もなかった。',
  '橋の上で立ち止まると、川面を渡る風が思いのほか強かった。',
  '知らない駅で降りてみたのは、ただ帰りたくなかったからだ。',
  'あるいは、あの手紙は届かないほうがよかったのかもしれない。',
  '母の話す昔のことは、聞くたびに少しずつ形を変えていった。',
  '軒先に吊るされた風鈴が鳴り、その音で目を覚ますことが増えた。',
  'すなわち、その日を境にして、二人の暮らしは静かに離れていった。',
  '待合室の椅子は硬く、時計の針が動く音ばかりが耳についた。',
  '言葉にしてしまえば消えるものがあると、彼はどこかで信じていた。',
  'たとえば、窓を開ける音ひとつでも、彼女には合図のように聞こえた。',
];

/** Numerals bound to counters — the main target of the cluster rules. */
const NUMERALS: readonly string[] = [
  '第3章の冒頭には、1897年の秋に起きた出来事が淡々と記されている。',
  '参加者は12人で、そのうち5人が初めての顔ぶれだった。',
  '開演は18時30分、上演時間はおよそ2時間15分と案内されていた。',
  '手元の資料によれば、対象となる件数は前年比で23パーセント増えている。',
  '彼はその質問に3回答え、4回目でようやく口をつぐんだ。',
  '校庭には7本の桜が並び、樹齢はどれも80年を超えるという。',
  '費用は1人あたり4800円、20人以上なら1割引になると書かれていた。',
  '距離にして12キロ、歩けば3時間近くかかる道のりだった。',
  '第2版では、初版にあった6つの誤りが静かに訂正されている。',
  '温度は氷点下5度まで下がり、湿度は40パーセントを切っていた。',
];

/** Prefixed words, which the prefix rule binds to the word that follows. */
const PREFIXED: readonly string[] = [
  'お名前とご住所をこちらの用紙にご記入ください、と係の人が言った。',
  '未確認の情報を不用意に広めるのは、ご遠慮いただきたいところだ。',
  '新製品のご案内は、来週の月曜日にお送りする予定になっている。',
  '御礼の品は不要だと伝えたのに、翌日には小さな包みが届いていた。',
  'お茶を淹れ直しながら、彼女は不機嫌そうにため息をついた。',
  'ご意見やご要望は、お手数ですが窓口までお寄せください。',
  '未完成の原稿をお見せするのは、どうにも気が進まなかった。',
  '副社長のご挨拶が終わると、会場の空気がわずかにゆるんだ。',
];

/** Latin runs inside Japanese text, which must not be cut mid-word. */
const LATIN: readonly string[] = [
  '組版処理はTypeScriptで書かれ、WebAssemblyの形態素解析器を呼び出している。',
  'EPUBの仕様ではCSSのwriting-modeを用いて縦書きを指定する。',
  'APIの応答はJSONで返り、UTF-8のまま保存される。',
  'Unicodeのコードポイント単位で扱うため、サロゲートペアの心配はない。',
  'HTMLとCSSだけで組んだ試作は、Safariでは意図通りに表示されなかった。',
  '彼のノートにはTODOという文字が並び、その下に日付が書き足されていた。',
  'GitHubに置かれたリポジトリのREADMEには、簡単な使い方だけが載っている。',
  'CanvasのmeasureTextで幅を測るので、フォントファイルの解析は行わない。',
];

/** Dialogue and heavy punctuation, where kinsoku forces the search to back up. */
const DIALOGUE: readonly string[] = [
  '「本当に、それでいいの」と彼女は聞いた。「いいんだ」と彼は答えた。',
  '「——それで、話は終わりですか」低い声がそう言った。',
  '「待って！」と叫んだが、扉はもう閉まっていた。',
  '彼は言った。「明日、もう一度ここへ来てほしい」と。',
  '「なぜ」「理由はない」「そう」——会話はそれきり途切れた。',
  '「ええと、その……つまり、こういうことなんです」と彼は口ごもった。',
  '「第一、そんな話は聞いていない」彼女はきっぱりと言い切った。',
  '「……分かりました」ようやくそう答えたとき、雨は上がっていた。',
];

/**
 * The order categories are drawn in, repeated for as long as text is needed.
 * Narrative dominates; the other four appear at the rate they do in prose that
 * is worth analysing at all.
 */
const CATEGORY_CYCLE: readonly (readonly string[])[] = [
  NARRATIVE,
  NARRATIVE,
  NUMERALS,
  NARRATIVE,
  PREFIXED,
  NARRATIVE,
  LATIN,
  NARRATIVE,
  NUMERALS,
  DIALOGUE,
  NARRATIVE,
  LATIN,
];

/** Sentences per paragraph, cycled so paragraph lengths vary without randomness. */
const PARAGRAPH_LENGTHS: readonly number[] = [4, 6, 3, 5, 7, 4, 5, 3, 6, 4];

/**
 * Builds a chapter-sized body of Japanese prose.
 *
 * The result is a pure function of `minChars`: the same argument always yields
 * the same string, which is what makes the benchmark's counts comparable across
 * runs and machines.
 *
 * @param minChars - Lower bound on the length in code points. The last paragraph
 *   is completed rather than truncated, so the result is slightly longer.
 * @returns Paragraphs joined by a line feed, which the layout engine treats as a
 *   hard break and the analyzer as a paragraph boundary.
 */
export function buildCorpus(minChars: number): string {
  const paragraphs = buildCorpusParagraphs(minChars);
  return paragraphs.join('\n');
}

/**
 * Builds the same corpus as {@link buildCorpus}, kept as separate paragraphs.
 *
 * Morphological analysis runs one paragraph at a time — offsets are relative to
 * the string handed to the analyzer — so a caller deriving hints needs the
 * paragraphs, not just their concatenation.
 *
 * @param minChars - Lower bound on the total length in code points.
 * @returns The paragraphs, in document order, none of them containing a line feed.
 */
export function buildCorpusParagraphs(minChars: number): string[] {
  const paragraphs: string[] = [];
  let total = 0;
  let sentenceIndex = 0;
  let paragraphIndex = 0;

  while (total < minChars) {
    const sentenceCount = PARAGRAPH_LENGTHS[paragraphIndex % PARAGRAPH_LENGTHS.length];
    let paragraph = '';
    for (let i = 0; i < sentenceCount; i++) {
      const pool = CATEGORY_CYCLE[sentenceIndex % CATEGORY_CYCLE.length];
      // The stride is coprime with every pool size, so a pool is walked in full
      // before it repeats and consecutive draws never pick the same sentence.
      paragraph += pool[(sentenceIndex * 7) % pool.length];
      sentenceIndex++;
    }
    paragraphs.push(paragraph);
    total += paragraph.length + 1;
    paragraphIndex++;
  }

  return paragraphs;
}

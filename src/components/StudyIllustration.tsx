import { Check, CheckCheck, BookOpen } from 'lucide-react';
export default function StudyIllustration() {
  return (
    <div className="study-art" aria-hidden="true">
      <div className="art-orbit orbit-one" />
      <div className="art-orbit orbit-two" />
      <span className="art-spark spark-one">✧</span>
      <span className="art-spark spark-two">✦</span>
      <div className="art-card">
        <div className="art-card-top">
          <span />
          <span />
          <span />
        </div>
        <div className="art-line short" />
        <div className="art-line" />
        <div className="art-task">
          <span>
            <Check size={12} />
          </span>
          <i />
        </div>
        <div className="art-task">
          <span>
            <Check size={12} />
          </span>
          <i />
        </div>
        <div className="art-task">
          <span />
          <i />
        </div>
      </div>
      <div className="art-book book-back" />
      <div className="art-book book-front">
        <BookOpen size={30} />
        <span>
          um passo
          <br />
          de cada vez.
        </span>
      </div>
      <div className="art-pot">
        <div className="leaf leaf-one" />
        <div className="leaf leaf-two" />
        <div className="leaf leaf-three" />
        <div className="pot" />
      </div>
      <div className="art-sticker">
        <CheckCheck size={18} />
        Você consegue.
      </div>
      <div className="art-ground" />
    </div>
  );
}

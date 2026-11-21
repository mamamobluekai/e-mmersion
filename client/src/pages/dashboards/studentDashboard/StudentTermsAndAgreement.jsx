import { TERMS_SECTIONS } from '../../../config/terms';
import { StudentSettingsBackButton } from './StudentSettings';
import styles from './StudentTermsAndAgreement.module.css';

export default function StudentTermsAndAgreement() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>WORK IMMERSION MONITORING SYSTEM</p>
        <h1>Terms and Agreement</h1>
        <p>Read the terms that apply when using the student portal.</p>
      </header>

      <article className={styles.document}>
        {TERMS_SECTIONS.map((section) => (
          <section className={styles.section} key={section.title}>
            <h2>{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.list && (
              <ul>
                {section.list.map((item) => <li key={item}>{item}</li>)}
              </ul>
            )}
          </section>
        ))}
      </article>

      <StudentSettingsBackButton />
    </main>
  );
}

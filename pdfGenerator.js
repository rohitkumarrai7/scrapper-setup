// pdfGenerator.js
// Loads jsPDF locally (no external CDN) and generates a formatted PDF

async function ensureJsPDF() {
  if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('libs/jspdf.umd.min.js');
    script.onload = () => {
      if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
      else reject(new Error('jsPDF not available after load'));
    };
    script.onerror = () => reject(new Error('Failed to load jsPDF'));
    document.head.appendChild(script);
  });
}

function addWrappedText(doc, text, x, y, maxWidth, lineHeight) {
  if (!text) return y;
  const split = doc.splitTextToSize(text, maxWidth);
  split.forEach((line) => {
    doc.text(line, x, y);
    y += lineHeight;
  });
  return y;
}

function ensureSpace(doc, y, needed, margin) {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - margin) {
    doc.addPage();
    return margin;
  }
  return y;
}

function sectionTitle(doc, title, y, margin) {
  y = ensureSpace(doc, y, 24, margin);
  doc.setFont(undefined, 'bold');
  doc.text(title, margin, y);
  doc.setFont(undefined, 'normal');
  return y + 12; // more gap after headings
}

function toTitle(str) {
  return (str || '')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .trim();
}

function displayName(data) {
  if (data.name && data.name.trim()) return data.name.trim();
  if (data.profileUrl) {
    const m = data.profileUrl.match(/\/in\/([^/]+)\/?/);
    if (m) return toTitle(m[1]);
  }
  return 'Unknown';
}

function bulletList(doc, items, x, y, maxWidth, lineHeight, margin) {
  if (!items || !items.length) return addWrappedText(doc, '—', x, y, maxWidth, lineHeight);
  for (const it of items) {
    const t = Array.isArray(it) ? it.join(' — ') : String(it || '');
    const lines = doc.splitTextToSize(`• ${t}`, maxWidth);
    // Reserve space for this bullet block
    y = ensureSpace(doc, y, lines.length * lineHeight + 2, margin);
    lines.forEach((line) => {
      doc.text(line, x, y);
      y += lineHeight;
    });
  }
  return y;
}

async function generateProfilePDF(data) {
  const jsPDF = await ensureJsPDF();
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  const margin = 40; // pt
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const LH = { content: 16, small: 14, bullet: 16 }; // line heights
  let y = margin;

  // Header
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text(displayName(data), margin, y);

  doc.setFontSize(12);
  doc.setFont(undefined, 'normal');
  if (data.headline) {
    y += 18;
    y = addWrappedText(doc, data.headline, margin, y, width, LH.content);
  } else {
    y += 10;
  }
  if (data.profileUrl) {
    y += 8;
    // reserve space for a single link line
    y = ensureSpace(doc, y, LH.content + 2, margin);
    doc.setTextColor(0, 102, 204);
    doc.textWithLink(data.profileUrl, margin, y, { url: data.profileUrl });
    doc.setTextColor(0, 0, 0);
  }
  y += 16;

  // Contact
  y = sectionTitle(doc, 'Contact', y, margin);
  const ci = data.contactInfo || { emails: [], phones: [], websites: [] };
  const contactLines = [];
  if (Array.isArray(ci.emails) && ci.emails.length) contactLines.push('Email: ' + ci.emails.join(', '));
  if (Array.isArray(ci.phones) && ci.phones.length) contactLines.push('Phone: ' + ci.phones.join(', '));
  if (Array.isArray(ci.websites) && ci.websites.length) contactLines.push('Websites: ' + ci.websites.join(', '));
  if (!contactLines.length) {
    y = addWrappedText(doc, '—', margin, y, width, LH.content);
  } else {
    for (const line of contactLines) {
      y = addWrappedText(doc, line, margin, y, width, LH.content);
    }
  }
  y += 12;

  // Summary (About)
  y = sectionTitle(doc, 'Summary', y, margin);
  y = addWrappedText(doc, (data.about && data.about.trim()) ? data.about : '—', margin, y, width, LH.content);
  y += 12;

  // Experience
  y = sectionTitle(doc, 'Experience', y, margin);
  if (data.experience && data.experience.length) {
    data.experience.forEach((e) => {
      const line1 = [e.title || '', e.subtitle || ''].filter(Boolean).join(' — ');
      if (line1) {
        const lines = doc.splitTextToSize(line1, width);
        y = ensureSpace(doc, y, lines.length * LH.content + 4, margin);
        doc.setFont(undefined, 'bold');
        y = addWrappedText(doc, line1, margin, y, width, LH.content);
        doc.setFont(undefined, 'normal');
      }
      if (e.dates) {
        const lines = doc.splitTextToSize(e.dates, width);
        y = ensureSpace(doc, y, lines.length * LH.small + 2, margin);
        y = addWrappedText(doc, e.dates, margin, y, width, LH.small);
      }
      if (e.description) {
        const lines = doc.splitTextToSize(e.description, width - 12);
        y = ensureSpace(doc, y, lines.length * LH.small + 2, margin);
        y = addWrappedText(doc, e.description, margin + 12, y, width - 12, LH.small);
      }
      y += 10;
    });
  } else {
    y = addWrappedText(doc, '—', margin, y, width, LH.content);
  }
  y += 12;

  // Skills (full list)
  y = sectionTitle(doc, 'Skills', y, margin);
  const allSkills = Array.isArray(data.skills) ? data.skills.filter(Boolean) : [];
  if (allSkills.length) {
    y = bulletList(doc, allSkills, margin, y, width, LH.bullet, margin);
  } else {
    y = addWrappedText(doc, '—', margin, y, width, LH.content);
  }
  y += 12;

  // Licenses & Certifications
  y = sectionTitle(doc, 'Licenses & Certifications', y, margin);
  const licenses = data.licenses || [];
  if (licenses.length) {
    licenses.forEach((e) => {
      const line1 = [e.title || '', e.subtitle || ''].filter(Boolean).join(' — ');
      if (line1) {
        const lines = doc.splitTextToSize(line1, width);
        y = ensureSpace(doc, y, lines.length * LH.content + 4, margin);
        doc.setFont(undefined, 'bold');
        y = addWrappedText(doc, line1, margin, y, width, LH.content);
        doc.setFont(undefined, 'normal');
      }
      if (e.dates) {
        const lines = doc.splitTextToSize(e.dates, width);
        y = ensureSpace(doc, y, lines.length * LH.small + 2, margin);
        y = addWrappedText(doc, e.dates, margin, y, width, LH.small);
      }
      if (e.description) {
        const lines = doc.splitTextToSize(e.description, width - 12);
        y = ensureSpace(doc, y, lines.length * LH.small + 2, margin);
        y = addWrappedText(doc, e.description, margin + 12, y, width - 12, LH.small);
      }
      y += 10;
    });
  } else {
    y = addWrappedText(doc, '—', margin, y, width, LH.content);
  }
  y += 12;

  // Top Skills
  const topSkills = Array.isArray(data.topSkills) && data.topSkills.length ? data.topSkills : allSkills.slice(0, 10);
  y = sectionTitle(doc, 'Top Skills', y, margin);
  if (topSkills.length) {
    y = bulletList(doc, topSkills, margin, y, width, LH.bullet, margin);
  } else {
    y = addWrappedText(doc, '—', margin, y, width, LH.content);
  }
  y += 12;

  // Recent Comments (last 7 days) — keep if present
  if (Array.isArray(data.comments)) {
    y = sectionTitle(doc, 'Recent Comments (last 7 days)', y, margin);
    if (data.comments.length) {
      const comments = data.comments;
      comments.forEach((c) => {
        const line = `${c.timestamp ? '[' + c.timestamp + '] ' : ''}${c.text || ''}`;
        const lines = doc.splitTextToSize(line, width);
        y = ensureSpace(doc, y, lines.length * LH.content + 2, margin);
        y = addWrappedText(doc, line, margin, y, width, LH.content);
        if (c.postLink) {
          doc.setTextColor(0, 102, 204);
          doc.textWithLink(c.postLink, margin, y, { url: c.postLink });
          doc.setTextColor(0, 0, 0);
          y += 16;
        } else {
          y += 8;
        }
      });
    } else {
      y = addWrappedText(doc, '—', margin, y, width, LH.content);
    }
  }

  // Education (optional, last)
  y = sectionTitle(doc, 'Education', y, margin);
  if (data.education && data.education.length) {
    data.education.forEach((e) => {
      const line1 = [e.title || '', e.subtitle || ''].filter(Boolean).join(' — ');
      if (line1) {
        const lines = doc.splitTextToSize(line1, width);
        y = ensureSpace(doc, y, lines.length * LH.content + 4, margin);
        doc.setFont(undefined, 'bold');
        y = addWrappedText(doc, line1, margin, y, width, LH.content);
        doc.setFont(undefined, 'normal');
      }
      if (e.dates) {
        const lines = doc.splitTextToSize(e.dates, width);
        y = ensureSpace(doc, y, lines.length * LH.small + 2, margin);
        y = addWrappedText(doc, e.dates, margin, y, width, LH.small);
      }
      if (e.description) {
        const lines = doc.splitTextToSize(e.description, width - 12);
        y = ensureSpace(doc, y, lines.length * LH.small + 2, margin);
        y = addWrappedText(doc, e.description, margin + 12, y, width - 12, LH.small);
      }
      y += 10;
    });
  } else {
    y = addWrappedText(doc, '—', margin, y, width, LH.content);
  }

  // Save
  const safeName = (displayName(data) || 'profile').replace(/[^a-z0-9\-_]+/gi, '_');
  doc.save(`${safeName}_linkedin.pdf`);
}

// Expose
window.generateProfilePDF = generateProfilePDF;

/*
 * Weave — weave.clinic
 * Main JavaScript
 */

// Mobile nav toggle
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav__toggle');
  const links = document.querySelector('.nav__links');

  if (toggle && links) {
    toggle.addEventListener('click', () => {
      links.classList.toggle('active');
      toggle.classList.toggle('active');
    });

    // Close nav on link click (mobile)
    links.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        links.classList.remove('active');
        toggle.classList.remove('active');
      });
    });
  }

  // FAQ accordion
  document.querySelectorAll('.faq__question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.parentElement;
      const wasActive = item.classList.contains('active');

      // Close all
      document.querySelectorAll('.faq__item').forEach(i => i.classList.remove('active'));

      // Toggle current
      if (!wasActive) {
        item.classList.add('active');
      }
    });
  });

  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Intersection Observer for fade-in animations
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

  document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

  // Exam prep download modal
  const EDGE_FN_URL = 'https://swnhmrljpafvaojaytkv.supabase.co/functions/v1/exam-prep-download';
  let pendingFileKey = null;

  window.handleDownload = function(btn) {
    const card = btn.closest('.exam-card');
    pendingFileKey = card.dataset.file;

    // Check localStorage for returning user
    const saved = localStorage.getItem('weave_exam_lead');
    if (saved) {
      const lead = JSON.parse(saved);
      triggerDownload(lead, pendingFileKey, btn);
      return;
    }

    // Show modal
    const modal = document.getElementById('downloadModal');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('dl-name').focus(), 100);
  };

  window.closeModal = function() {
    const modal = document.getElementById('downloadModal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
    document.getElementById('downloadError').style.display = 'none';
    pendingFileKey = null;
  };

  window.submitDownload = async function(e) {
    e.preventDefault();
    const form = document.getElementById('downloadForm');
    const submitBtn = form.querySelector('.download-modal__submit');
    const errorEl = document.getElementById('downloadError');
    errorEl.style.display = 'none';

    const lead = {
      name: form.querySelector('#dl-name').value.trim(),
      email: form.querySelector('#dl-email').value.trim(),
      institution: form.querySelector('#dl-institution').value.trim(),
      year: form.querySelector('#dl-year').value,
      exam: form.querySelector('#dl-exam').value,
    };

    if (!lead.name || !lead.email) {
      errorEl.textContent = 'Name and email are required.';
      errorEl.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Preparing download...';

    try {
      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...lead, file_key: pendingFileKey }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Download failed');
      }

      // Save lead to localStorage
      localStorage.setItem('weave_exam_lead', JSON.stringify(lead));

      // Trigger download
      const a = document.createElement('a');
      a.href = data.download_url;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();

      closeModal();
      form.reset();
    } catch (err) {
      errorEl.textContent = err.message || 'Something went wrong. Please try again.';
      errorEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Download PDF';
    }
  };

  async function triggerDownload(lead, fileKey, btn) {
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing...';

    try {
      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...lead, file_key: fileKey }),
      });

      const data = await res.json();

      if (!res.ok) {
        // If file not found, might need to re-auth
        if (res.status === 500) {
          localStorage.removeItem('weave_exam_lead');
          btn.textContent = originalText;
          btn.disabled = false;
          window.handleDownload(btn);
          return;
        }
        throw new Error(data.error);
      }

      const a = document.createElement('a');
      a.href = data.download_url;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      alert('Download failed: ' + (err.message || 'Please try again.'));
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }

  // Close modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('downloadModal');
      if (modal && modal.classList.contains('active')) {
        closeModal();
      }
    }
  });

  // WhatsApp form handler (contact page)
  const form = document.querySelector('.form');
  if (form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();

      const name = form.querySelector('[name="name"]')?.value || '';
      const phone = form.querySelector('[name="phone"]')?.value || '';
      const age = form.querySelector('[name="age"]')?.value || '';
      const message = form.querySelector('[name="message"]')?.value || '';
      const seen_before = form.querySelector('[name="seen_before"]:checked')?.value || '';
      const preferred = form.querySelector('[name="preferred_doctor"]:checked')?.value || '';
      const city = form.querySelector('[name="city"]')?.value || '';
      const consultation_type = form.querySelector('[name="consultation_type"]')?.value || '';

      let text = `Hi, I'd like to reach out to Weave.\n\n`;
      if (name) text += `Name: ${name}\n`;
      if (phone) text += `Phone: ${phone}\n`;
      if (age) text += `Age range: ${age}\n`;
      if (city) text += `City: ${city}\n`;
      if (seen_before) text += `Seen someone before: ${seen_before}\n`;
      if (preferred) text += `Preferred doctor: ${preferred}\n`;
      if (consultation_type) text += `Consultation type: ${consultation_type}\n`;
      if (message) text += `\nWhat I'm going through:\n${message}`;

      const encoded = encodeURIComponent(text.trim());
      window.open(`https://wa.me/917625004229?text=${encoded}`, '_blank');
    });
  }
});

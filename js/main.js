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

      let text = `Hi, I'd like to reach out to Weave.\n\n`;
      if (name) text += `Name: ${name}\n`;
      if (phone) text += `Phone: ${phone}\n`;
      if (age) text += `Age range: ${age}\n`;
      if (city) text += `City: ${city}\n`;
      if (seen_before) text += `Seen someone before: ${seen_before}\n`;
      if (preferred) text += `Preferred doctor: ${preferred}\n`;
      if (message) text += `\nWhat's on my mind:\n${message}`;

      const encoded = encodeURIComponent(text.trim());
      window.open(`https://wa.me/917625004229?text=${encoded}`, '_blank');
    });
  }
});

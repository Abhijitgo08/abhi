// contact.js
document.addEventListener("DOMContentLoaded", () => {
  const ENDPOINT = "https://formspree.io/f/xzzjbpbo"; // your Formspree endpoint
  const form = document.getElementById("contactForm");
  const responseBox = document.getElementById("formResponse");
  const submitButton = form.querySelector('button[type="submit"]');

  function showMessage(text, kind = "info") {
    // kind: info | success | error
    responseBox.textContent = text;
    responseBox.classList.remove("hidden");
    responseBox.className = "mt-6 text-center text-lg font-semibold";

    if (kind === "success") {
      responseBox.classList.add("text-green-700");
    } else if (kind === "error") {
      responseBox.classList.add("text-red-600");
    } else {
      responseBox.classList.add("text-gray-700");
    }
  }

  function setButtonLoading(isLoading) {
    if (!submitButton) return;
    submitButton.disabled = isLoading;
    if (isLoading) {
      submitButton.dataset.origText = submitButton.textContent;
      submitButton.textContent = "Sending…";
      submitButton.classList.add("opacity-75", "cursor-not-allowed");
    } else {
      submitButton.textContent = submitButton.dataset.origText || "Send Message";
      submitButton.classList.remove("opacity-75", "cursor-not-allowed");
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    responseBox.classList.add("hidden");

    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const message = document.getElementById("message").value.trim();

    if (!name || !email || !message) {
      showMessage("⚠️ Please fill out all fields.", "error");
      return;
    }

    // Optional: quick client-side email format check
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email)) {
      showMessage("⚠️ Please enter a valid email address.", "error");
      return;
    }

    setButtonLoading(true);

    try {
      // Formspree accepts JSON posts — send JSON so we don't need name attributes in the markup
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name,
          email,
          message
        })
      });

      // success = 200/201 and res.ok
      if (res.ok) {
        showMessage(`✅ Thank you, ${name}! Your message has been sent.`, "success");
        form.reset();
      } else {
        // try to parse error from Formspree
        let errText = "❌ Failed to send message. Please try again later.";
        try {
          const data = await res.json();
          if (data && data.error) errText = `❌ ${data.error}`;
          else if (data && data.errors && data.errors.length) {
            errText = `❌ ${data.errors.map(e => e.message || e).join(", ")}`;
          }
        } catch (_) { /* ignore parse errors */ }

        showMessage(errText, "error");
      }
    } catch (err) {
      console.error("Contact form error:", err);
      showMessage("❌ Error: Could not connect to email service.", "error");
    } finally {
      setButtonLoading(false);
    }
  });
});

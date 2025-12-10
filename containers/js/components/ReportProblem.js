// js/components/ReportProblem.js
// Report Problem dropdown component for Containers app
// Sends JSON configuration instead of URL

window.CartonApp = window.CartonApp || {};
window.CartonApp.Components = window.CartonApp.Components || {};

window.CartonApp.Components.ReportProblem = function ({ getJsonConfig }) {
  const { useState, useRef, useEffect } = React;

  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");
  const [challenge, setChallenge] = useState("");
  const [status, setStatus] = useState(null); // 'sending' | 'success' | 'error' | 'rate-limited'
  const [errorMsg, setErrorMsg] = useState("");
  const [jsonPreview, setJsonPreview] = useState("");
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Generate JSON preview when opening
  useEffect(() => {
    if (isOpen && getJsonConfig) {
      setJsonPreview(getJsonConfig());
    }
  }, [isOpen, getJsonConfig]);

  // Rate limiting: max 3 submissions per hour (stored in localStorage)
  const checkRateLimit = () => {
    const RATE_LIMIT = 3;
    const WINDOW_MS = 60 * 60 * 1000; // 1 hour
    const now = Date.now();

    let submissions = [];
    try {
      submissions = JSON.parse(localStorage.getItem("reportSubmissions") || "[]");
    } catch (e) {
      submissions = [];
    }

    // Filter to only submissions within the window
    submissions = submissions.filter((ts) => now - ts < WINDOW_MS);

    if (submissions.length >= RATE_LIMIT) {
      return false;
    }

    // Record this submission
    submissions.push(now);
    localStorage.setItem("reportSubmissions", JSON.stringify(submissions));
    return true;
  };

  // Validate challenge answer
  const validateChallenge = (answer) => {
    const normalized = answer.toUpperCase().replace(/\s+/g, "");
    return normalized === "SK91AX";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");

    // Validate challenge
    if (!validateChallenge(challenge)) {
      setErrorMsg("Incorrect answer. Hint: It's a UK postcode format.");
      return;
    }

    // Check rate limit
    if (!checkRateLimit()) {
      setStatus("rate-limited");
      setErrorMsg("Too many submissions. Please try again later.");
      return;
    }

    setStatus("sending");

    try {
      // Get fresh JSON config at submission time
      const currentJson = getJsonConfig ? getJsonConfig() : "";

      const response = await fetch("/api/send-report.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          description,
          jsonConfig: currentJson,
          source: "containers",
          challenge,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setStatus("success");
        setDescription("");
        setChallenge("");
        setEmail("");

        // Close after success
        setTimeout(() => {
          setIsOpen(false);
          setStatus(null);
        }, 2000);
      } else {
        setStatus("error");
        setErrorMsg(data.error || "Failed to send report. Please try again.");
      }
    } catch (err) {
      setStatus("error");
      setErrorMsg("Network error. Please try again.");
    }
  };

  const resetForm = () => {
    setStatus(null);
    setErrorMsg("");
    setEmail("");
    setDescription("");
    setChallenge("");
  };

  return React.createElement(
    "div",
    { className: "relative", ref: dropdownRef },

    // Trigger button
    React.createElement(
      "button",
      {
        onClick: () => {
          setIsOpen(!isOpen);
          if (!isOpen) resetForm();
        },
        className: "px-3 py-1.5 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600 transition-colors text-white",
      },
      "Report Problem"
    ),

    // Dropdown modal
    isOpen &&
      React.createElement(
        "div",
        {
          className: "absolute right-0 top-full mt-2 w-96 bg-white rounded-xl shadow-lg border border-gray-200 z-50",
        },

        // Header
        React.createElement(
          "div",
          { className: "px-4 py-3 border-b border-gray-100" },
          React.createElement(
            "h3",
            { className: "font-semibold text-gray-900" },
            "Report a Problem"
          ),
          React.createElement(
            "p",
            { className: "text-xs text-gray-500 mt-1" },
            "Your current configuration (JSON) will be included automatically."
          )
        ),

        // Form
        React.createElement(
          "form",
          { onSubmit: handleSubmit, className: "p-4 space-y-3" },

          // JSON Config preview (read-only)
          React.createElement(
            "div",
            {},
            React.createElement(
              "label",
              { className: "block text-xs font-medium text-gray-600 mb-1" },
              "Configuration (will be sent)"
            ),
            React.createElement(
              "div",
              {
                className: "text-xs bg-gray-50 p-2 rounded border border-gray-200 text-gray-600 font-mono max-h-24 overflow-y-auto whitespace-pre-wrap break-all",
              },
              jsonPreview ? jsonPreview.substring(0, 500) + (jsonPreview.length > 500 ? "..." : "") : "(generating...)"
            )
          ),

          // Email address
          React.createElement(
            "div",
            {},
            React.createElement(
              "label",
              { className: "block text-xs font-medium text-gray-600 mb-1" },
              "Your email"
            ),
            React.createElement("input", {
              type: "email",
              value: email,
              onChange: (e) => setEmail(e.target.value),
              placeholder: "you@example.com",
              required: true,
              className: "w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white text-gray-900",
            })
          ),

          // Description
          React.createElement(
            "div",
            {},
            React.createElement(
              "label",
              { className: "block text-xs font-medium text-gray-600 mb-1" },
              "Description (optional)"
            ),
            React.createElement("textarea", {
              value: description,
              onChange: (e) => setDescription(e.target.value),
              placeholder: "Describe the issue...",
              rows: 3,
              className: "w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none bg-white text-gray-900",
            })
          ),

          // Challenge question
          React.createElement(
            "div",
            {},
            React.createElement(
              "label",
              { className: "block text-xs font-medium text-gray-600 mb-1" },
              "Security check: Wilmslow HQ postcode?"
            ),
            React.createElement("input", {
              type: "text",
              value: challenge,
              onChange: (e) => setChallenge(e.target.value),
              placeholder: "e.g. AB1 2CD",
              required: true,
              className: "w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white text-gray-900",
            })
          ),

          // Error message
          errorMsg &&
            React.createElement(
              "div",
              { className: "text-xs text-red-600 bg-red-50 p-2 rounded" },
              errorMsg
            ),

          // Success message
          status === "success" &&
            React.createElement(
              "div",
              { className: "text-xs text-green-600 bg-green-50 p-2 rounded" },
              "Report sent successfully!"
            ),

          // Submit button
          React.createElement(
            "button",
            {
              type: "submit",
              disabled: status === "sending" || status === "success",
              className: `w-full py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                status === "sending" || status === "success"
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-blue-500 hover:bg-blue-600 text-white"
              }`,
            },
            status === "sending"
              ? "Sending..."
              : status === "success"
              ? "Sent!"
              : "Send Report"
          )
        )
      )
  );
};

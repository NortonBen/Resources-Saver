# Chrome Web Store — permission justifications

Copy the text below into the **Privacy** → **Permission justification** fields when submitting **Resources Saver** (limit: 1,000 characters per field).

---

## scripting

Resources Saver uses `scripting` only on the tab the user pins as the capture target in the side panel. When the user runs **DOM scan** or starts capture, we inject a short, read-only function that lists page-linked assets (images, scripts, stylesheets, fonts, media) from the DOM. We do not change page content, show ads, or run on tabs without a clear user action for that tab. `scripting` is also used to fetch some resource bytes in-page (with the user’s cookies) when downloading assets from the monitored tab, so saves work for same-site files the user can already load in the browser. All processing stays local; nothing is sent to our servers.

---

## webRequest

Resources Saver uses `webRequest` with `onCompleted` only while **Network monitor** is active for a user-chosen tab. We record the URL (and basic response metadata such as content type) of completed network requests for that tab so the resource list updates as the page loads more files. We do not block, redirect, modify, or read request bodies. Observed URLs are kept in extension memory and shown in the side panel; they are not uploaded elsewhere. Monitoring stops when the user taps **Stop** or closes the target tab.

---

## host_permissions (`http://*/*`, `https://*/*`, etc.)

The extension downloads and saves files the user selects from pages they visit. Host access is required to `fetch` resource URLs (with extension-initiated requests) and to run the DOM scanner on normal web pages. We only access hosts when the user uses save or scan features on a tab they are viewing; we do not browse the web in the background.

---

## tabs / sidePanel / downloads / storage

- **tabs** — Read the active tab URL/title so the side panel can show **Target Website** and pin the correct tab for monitoring.
- **sidePanel** — Provide the main UI to list, filter, and download page resources.
- **downloads** — Save files the user chooses to disk, optionally as a ZIP, preserving folder structure.
- **storage** — Store local settings (e.g. group-by-type, debug mode) on the device only.

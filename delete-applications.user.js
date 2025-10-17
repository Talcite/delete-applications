/*
Wikidot applications deleter userscript

For installation instructions, see https://scpwiki.com/usertools
*/

/* CHANGELOG

v1.3.1 (2024-10-10)
- Userscript controls are now stored in a generic container available to other userscripts.

v1.3.0 (2023-09-08)
- Added changelog.
- Removed extra commas from the confirmation popup when deleting applications from more than one site.
- Deletes now execute in batches of 100 separated by a short delay to bypass Wikidot's single-request limit of 996.
- Made buttons larger and added more support links.

v1.2.0 (2023-07-07)
- Added a list of sites to the deletion confirmation popup that tells you which Wikidot sites the applications come from, and how many there are per site.

v1.1.0 (2022-04-11)
- Added new feature 'delete recent applications' that deletes applications page-by-page until encountering a page with no applications.
- Removed feature 'delete applications on current page'.
- After scanning pages of messages, script now puts you back on the first page instead of leaving you wherever it stopped.
- The delete buttons are now visible on all pages of the inbox instead of just the first.

v1.0.1 (2022-03-06)
- Hid buttons when reading a message.
- Fixed deletion confirmation popup interfering with message composer UI.

v1.0.0 (2022-03-01)
- Created userscript.
*/

// ==UserScript==
// @name        Wikidot applications deleter
// @description Adds a button to delete applications from your Wikidot inbox.
// @author      Croquembouche
// @version     v1.3.1
// @updateURL   https://github.com/croque-scp/delete-applications/raw/main/delete-applications.user.js
// @downloadURL https://github.com/croque-scp/delete-applications/raw/main/delete-applications.user.js
// @supportURL  https://www.wikidot.com/account/messages#/new/2893766
// @match       https://www.wikidot.com/account/messages*
// ==/UserScript==

/* global WIKIDOT, OZONE */

const applicationTextsByLang = {
  english: {
    subject: "You received a membership application",
    preview: /applied for membership on (.*), one of your sites/,
  },
  catalan: {
    subject: "Heu rebut una sol·licitud de pertinença",
    preview: /ha sol·licitat la subscripció a (.*), un dels vostres llocs/,
  },
  chineseSimplified: {
    subject: "您收到了一份成员资格申请",
    preview: /申请成为您管理的网站 (.*) 的成员/,
  },
  chineseTraditional: {
    subject: "您收到了一封成員資格申請書",
    preview: /todo/,
  },
  czech: {
    subject: "Dostal jsi žádanku o členství",
    preview: /todo/,
  },
  esperanto: {
    subject: "Vi ricevis membriĝpeton",
    preview: /todo/,
  },
  french: {
    subject: "Vous avez reçu une demande d'adhésion",
    preview: /todo/,
  },
  german: {
    subject: "Sie haben ein Antrag zur Mitgliedschaft erhalten",
    preview: /todo/,
  },
  italian: {
    subject: "Hai ricevuto una domanda di adesione",
    preview: /todo/,
  },
  japanese: {
    subject: "参加希望書を受け取りました。",
    preview: /todo/,
  },
  korean: {
    subject: "회원가입 신청서를 받았습니다.",
    preview: /todo/,
  },
  spanish: {
    subject: "Has recibido una petición de membresía",
    preview: /todo/,
  },
  polish: {
    subject: "Otrzymałeś aplikację o członkostwo",
    preview: /todo/,
  },
  russian: {
    subject: "Вам подана заявка на участие",
    preview: /todo/,
  },
  serbian: {
    subject: "Добили сте пријаву за чланство",
    preview: /todo/,
  },
  vietnamese: {
    subject: "Bạn đã nhận được đơn tham gia",
    preview: /todo/,
  },
}

/* ===== Utilities ===== */

const deleterDebug = log => console.debug("Applications deleter:", log)

const supportUser = showAvatar => `
  ${
    showAvatar
      ? `<span class="printuser avatarhover" style="white-space: nowrap">`
      : ""
  }
    <a href="https://www.wikidot.com/user:info/croquembouche" onclick="WIKIDOT.page.listeners.userInfo(2893766); return false;" >
      ${
        showAvatar
          ? `<img
              class="small"
              src="https://www.wikidot.com/avatar.php?userid=2893766" style="background-image:url(https://www.wikidot.com/userkarma.php?u=2893766)"
            >`
          : ""
      }Croquembouche
    </a>
  ${showAvatar ? `</span>` : ""}
`

function getMessagesOnPage() {
  return Array.from(document.querySelectorAll("tr.message")).map(
    el => new Message(el)
  )
}

function countSelected(messages) {
  return messages.reduce((a, b) => a + b.isSelected, 0)
}

class Counter {
  constructor(array) {
    array.forEach(val => (this[val] = (this[val] || 0) + 1))
  }
}

/**
 * Waits for the given number of milliseconds.
 * @param {Number} ms
 */
async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

class Message {
  /**
   * Collates details about a message based on its little preview.
   * @param {HTMLElement} messageElement - Inbox container.
   */
  constructor(messageElement) {
    /** @type {HTMLInputElement} */
    this.selector = messageElement.querySelector("input[type=checkbox]")
    /** @type {String} */
    this.id = this.selector.value

    // Extract the sender and the subject
    const from = messageElement.querySelector("td .from .printuser")
    this.fromWikidot =
      !from.classList.contains("avatarhover") && from.innerText === "Wikidot"
    this.subject = messageElement.querySelector(".subject").innerText
    this.previewText = messageElement.querySelector(".preview").innerText

    this.isApplication =
      this.fromWikidot && applicationSubjectsByLang.includes(this.subject)

    // Is this message an application?
    if (this.fromWikidot && subjectTexts.includes(this.subject)) {
      this.isApplication = true
    }

    if (this.isApplication) {
      // Which wiki is the application for?
      const wikiMatch = this.previewText.match(
        /applied for membership on (.*), one of your sites/
      )
      if (wikiMatch) this.applicationWiki = wikiMatch[1]
      else this.isApplication = false
    }
  }

  select() {
    this.selector.checked = true
  }
  deselect() {
    this.selector.checked = false
  }
  get isSelected() {
    return this.selector.checked
  }
}

/* ===== */

async function deleteApplications(deleteAll = false) {
  const applications = []
  const messageElement = document.getElementById("message-area")

  let goToNextPage = true
  let thereAreMorePages = true

  const scanningModal = new OZONE.dialogs.WaitBox()
  scanningModal.content = "Scanning your inbox for applications..."
  scanningModal.show()

  await firstPage(messageElement)

  do {
    const messages = getMessagesOnPage()

    // If no messages are selected, select all messages
    if (countSelected(messages) === 0) {
      messages.forEach(message => message.select())
    }

    // Deselect all messages that are not applications
    messages.forEach(message => {
      if (!message.isApplication) message.deselect()
    })

    // Save all selected messages
    const selectedMessages = messages.filter(message => message.isSelected)
    deleterDebug(`Found ${selectedMessages.length} applications`)
    applications.push(selectedMessages)

    // If there were no selected messages, and we are only deleting recent messages (i.e. deleteAll is false), don't go to the next page
    if (selectedMessages.length === 0 && !deleteAll) goToNextPage = false

    if (goToNextPage) thereAreMorePages = await nextPage(messageElement)
  } while (goToNextPage && thereAreMorePages)

  // Reset UI back to the first page
  await firstPage(messageElement)

  // Delete all saved messages
  createDeleteConfirmationModal(applications.flat())
}

/**
 * @param {Message[]} messages
 */
function createDeleteConfirmationModal(messages) {
  const messagesCount = messages.length

  // Collate the wikis that the applications were for
  const wikiCounter = new Counter(messages.map(m => m.applicationWiki))
  // Produce a confirmation modal with the number of applications to delete
  const confirmModal = new OZONE.dialogs.ConfirmationDialog()
  const applicationSitesList = Object.entries(wikiCounter).map(
    ([wiki, count]) => `<li>${wiki}: ${count}</li>`
  )
  confirmModal.content = `
    <p>Delete ${messagesCount} applications?</p>
    <p><em>Please report any issues during the deletion process to ${supportUser(
      true
    )}.</em></p>
    <ul>${applicationSitesList.join("")}</ul>
  `
  confirmModal.buttons = ["cancel", "delete applications"]
  confirmModal.addButtonListener("cancel", confirmModal.close)
  confirmModal.addButtonListener("delete applications", async () => {
    const progressModal = new OZONE.dialogs.SuccessBox()
    progressModal.content = `
      <p>Deleting ${messagesCount} applications...</p>
      <p id="delete-progress-text"></p>
      <progress id="delete-progress" style="width: 100%"></progress>
    `
    progressModal.timeout = null
    progressModal.show()

    const success = await deleteMessagesBatches(
      messages,
      async (batchIndex, batchCount, batchSize) => {
        if (batchCount === 1) return
        document.getElementById("delete-progress-text").textContent = `
          Batch ${batchIndex + 1} of ${batchCount} (${batchSize} applications)
        `
        document.getElementById("delete-progress").max = batchCount
        document.getElementById("delete-progress").value = batchIndex + 1
        await wait(1500)
      }
    )

    WIKIDOT.modules.DashboardMessagesModule.app.refresh()

    if (success) {
      const successModal = new OZONE.dialogs.SuccessBox()
      successModal.content = `
        <p>Deleted ${messagesCount} applications.<p>
      `
      successModal.show()
    } else {
      const errorModal = new OZONE.dialogs.ErrorDialog()
      errorModal.content = `
        <p>Failed to delete applications.</p>
        <p>Please send a message to ${supportUser(true)}.</p>
      `
      errorModal.show()
    }
  })

  confirmModal.focusButton = "cancel"
  confirmModal.show()
}

/**
 * @callback deleteMessagesBatches_beforeBatch
 * @param {Number} batchIndex
 * @param {Number} batchCount
 * @param {Number} batchSize
 * @return {Promise<void>}
 */

/**
 * Deletes the given messages in batches.
 * @param {Message[]} messages
 * @param {deleteMessagesBatches_beforeBatch} beforeBatch - Callback that receives deletion progress info.
 * @return {Promise<Boolean>} True when all deletes succeeded.
 */
async function deleteMessagesBatches(messages, beforeBatch) {
  const batchSize = 100
  const batchCount = Math.ceil(messages.length / batchSize)
  let batchIndex = 0
  while (messages.length) {
    const batch = messages.splice(0, batchSize)
    await beforeBatch(batchIndex, batchCount, batch.length)
    try {
      await deleteMessages(batch.map(message => message.id))
    } catch (error) {
      deleterDebug("Deletes failed")
      console.error(error)
      return false
    }
    batchIndex += 1
  }
  return true
}

/**
 * Delete the messages with the given IDs.
 * @param {Number[]} messageIds
 */
function deleteMessages(messageIds) {
  return new Promise((resolve, reject) => {
    try {
      OZONE.ajax.requestModule(
        null,
        {
          action: "DashboardMessageAction",
          event: "removeMessages",
          messages: messageIds,
        },
        resolve
      )
    } catch (error) {
      reject(error)
    }
  })
}

/**
 * Whether to show the deletion buttons, based on the current URL.
 * @returns {Boolean}
 */
function shouldShowDeleteButtons() {
  return /^(#(\/inbox(\/(p[0-9]+\/?)?)?)?)?$/.test(location.hash)
}

/**
 * Go to the first page of messages.
 * @param {HTMLElement} messageElement - Inbox container
 * @returns {Promise<Boolean>}
 */
async function firstPage(messageElement) {
  deleterDebug("Going to first page")
  const pager = messageElement.querySelector(".pager")
  if (pager == null) return false
  const currentPageButton = pager.querySelector(".current")
  if (currentPageButton == null) return false
  if (currentPageButton.textContent.trim() === "1") return false

  // The first page button should always be visible
  const firstPageButton = pager.querySelector(".target [href='#/inbox/p1']")
  if (firstPageButton == null) return false

  // Click the button and return once the page has reloaded
  await new Promise(resolve => {
    const observer = new MutationObserver(() => {
      observer.disconnect()
      resolve()
    })
    observer.observe(messageElement, { childList: true })

    firstPageButton.click()
  })
  return true
}

/**
 * Iterate to the next page of messages.
 *
 * @param {HTMLElement} messageElement - Inbox container
 * @returns {Promise<Boolean>} False if last page; otherwise wait for next page to load then true.
 */
async function nextPage(messageElement) {
  deleterDebug("Going to next page")
  const pager = messageElement.querySelector(".pager")
  if (pager == null) return false
  const nextButton = pager.querySelector(".target:last-child a")
  if (nextButton == null) return false
  if (nextButton.textContent.trim() !== "next »") return false

  // Wait until the next page has finished loading
  await new Promise(resolve => {
    const observer = new MutationObserver(() => {
      observer.disconnect()
      resolve()
    })
    observer.observe(messageElement, { childList: true })

    nextButton.click()
  })
  return true
}

;(function () {
  // Set up container for userscript controls, unless another userscript already did
  let scriptControlContainer = document.getElementById("messages-userscripts")
  if (!scriptControlContainer) {
    scriptControlContainer = document.createElement("div")
    scriptControlContainer.id = "messages-userscripts"
    scriptControlContainer.style.display = "flex"
    scriptControlContainer.style.justifyContent = "end"
    scriptControlContainer.style.flexWrap = "wrap"
    scriptControlContainer.style.marginBlock = "1.5rem"
    scriptControlContainer.style.gap = "1.5rem"

    document
      .getElementById("message-area")
      .parentElement.prepend(scriptControlContainer)
  }

  const deleteButtonsContainer = document.createElement("div")
  deleteButtonsContainer.id = "delete-applications-controls"
  deleteButtonsContainer.style.border = "thin solid lightgrey"
  deleteButtonsContainer.style.borderRadius = "0.5rem"
  deleteButtonsContainer.style.display = shouldShowDeleteButtons()
    ? "flex"
    : "none"
  deleteButtonsContainer.style.flexDirection = "column"
  deleteButtonsContainer.style.maxWidth = "max-content"
  deleteButtonsContainer.style.padding = "1rem 1rem 0"
  deleteButtonsContainer.innerHTML = `
    <p style="font-size: smaller">
      <a href="https://scpwiki.com/usertools#delete-applications">Delete applications</a> by ${supportUser()}
    </p>
    <p id="delete-applications-buttons" style="
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      gap: 0.5rem;
    "></p>
  `

  scriptControlContainer.appendChild(deleteButtonsContainer)

  // Create the buttons
  const deleteRecentButton = document.createElement("button")
  deleteRecentButton.innerText = "Delete recent applications"
  deleteRecentButton.classList.add("red", "btn", "btn-danger")
  deleteRecentButton.title = `
    Delete recent applications.
    Deletes applications on the first page, then the second, and so on, until a page with no applications is found.
  `
    .replace(/\s+/g, " ")
    .trim()
  deleteRecentButton.addEventListener("click", () => deleteApplications(false))

  const deleteAllButton = document.createElement("button")
  deleteAllButton.innerText = "Delete all applications"
  deleteAllButton.classList.add("red", "btn", "btn-danger")
  deleteAllButton.title = `
    Delete all applications in your inbox.
    May take a while if you have a lot.
  `
    .replace(/\s+/g, " ")
    .trim()
  deleteAllButton.addEventListener("click", () => deleteApplications(true))

  deleteButtonsContainer
    .querySelector("#delete-applications-buttons")
    .append(deleteRecentButton, deleteAllButton)

  // Detect clicks to messages and inbox tabs and hide/show buttons as appropriate
  addEventListener("click", () =>
    setTimeout(() => {
      deleteButtonsContainer.style.display = shouldShowDeleteButtons()
        ? "flex"
        : "none"
    }, 500)
  )
})()

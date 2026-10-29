window.onload = async function() {  

    let expenseCurrentlyActive;
    let receiptCurrentlyActive;
    const expenseId = Number(sessionStorage.getItem("expenseCurrentlyActive"));

    //#region Getting active expense


    try {
        await dbConnectionPromise;
    } 
    
    catch (error) {
        console.log("Unable to initialize the expenses database:", error);
        return;
    }

    if (!Number.isSafeInteger(expenseId) || expenseId <= 0) {
        console.log("No valid active expense ID was found in session storage.");
        return;
    }

    
    try {
        const transaction = dbConnection.transaction(dbStoreObject, "readonly");
        const dbStoreObjectReference = transaction.objectStore(dbStoreObject);
        const getExpenseRequest = dbStoreObjectReference.get(expenseId);

        expenseCurrentlyActive = await new Promise((resolve, reject) => {
            getExpenseRequest.onsuccess = () => resolve(getExpenseRequest.result);
            getExpenseRequest.onerror = () => reject(getExpenseRequest.error);
        });
    } 
    
    catch (error) {
        console.log("Error fetching active expense:", error);
        return;
    }

    if (!expenseCurrentlyActive) {
        console.log(`Expense ${expenseId} was not found in the database.`);
        return;
    }

    console.log("Active expense:", expenseCurrentlyActive);

    //#endregion


    //#region Getting first receipt data - whether it exists or is empty

    const modal = new bootstrap.Modal(
        document.getElementById('receiptUploadModal'),
        { backdrop: "static" }
    );

    const localUploadButton = document.getElementById("receiptUploadLocalUploadButton");
    const tabScannerButton = document.getElementById("receiptUploadTabScannerButton");
    const receiptUploadNew = document.getElementById("receiptUploadNew");
    const receiptDeleteButton = document.getElementById("receiptDelete");
    const receiptFileInput = document.getElementById("receiptFileInput");
    const receiptNameInput = document.getElementById("receiptName");
    const receiptFileFeedback = document.getElementById("receiptFileFeedback");
    const receiptUploadOptions = document.getElementById("receiptUploadOptions");
    const receiptScannerLoading = document.getElementById("receiptScannerLoading");
    const expenseImageContainer =
        document.getElementById("expenseImageContainer");


    const expenseReceipts = Array.isArray(expenseCurrentlyActive.expenseReceipts)
        ? expenseCurrentlyActive.expenseReceipts
        : [];
    expenseCurrentlyActive.expenseReceipts = expenseReceipts;

    const expenseFirstReceiptIndex = 0;
    receiptCurrentlyActive = expenseReceipts[expenseFirstReceiptIndex];

    //#endregion


    //#region Select expense payer

    const expenseSelectPayer = document.getElementById("expenseSelectPayer");
    let expenseSelectPayerHTML = `
        <option value="" selected disabled>
            Select expense payer
        </option>
    `;

    for(let i = 0; i < expenseCurrentlyActive.expenseParticipants.length; i++){
        expenseSelectPayerHTML += `
            <option value="${i+1}">${expenseCurrentlyActive.expenseParticipants[i]}</option>
        `;
    }

    expenseSelectPayer.innerHTML = expenseSelectPayerHTML;

    //#endregion
  

    //#region Persisting expense in the DB

    const persistExpense = async (expense) => {
        const transaction = dbConnection.transaction(dbStoreObject, "readwrite");
        const saveRequest = transaction
            .objectStore(dbStoreObject)
            .put(expense);

        await new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
            saveRequest.onerror = () => reject(saveRequest.error);
        });
    };

    //#endregion


    //#region Returning details about currently active receipt

    const getReceiptCurrentlyActiveDetails = (receiptImg = receiptCurrentlyActive?.receiptImg) => {
        const payerIndex = Number(expenseSelectPayer.value) - 1;
        const receiptName = receiptNameInput.value.trim();
        const receiptLineItems = Array.from(
            expenseLineItemsList.querySelectorAll(".expense-line-item")
        ).map(lineItem => {
            const name = lineItem.querySelector(".line-item-name").value.trim();
            const price = lineItem.querySelector(".line-item-price").value;
            const participants = Array.from(
                lineItem.querySelectorAll(".participant-option:checked")
            ).map(checkbox => checkbox.nextElementSibling.textContent.trim());

            return { name, price, participants };
        }).filter(lineItem =>
            lineItem.name || lineItem.price || lineItem.participants.length
        );

        return {
            receiptName,
            receiptImg,
            receiptPayer: expenseCurrentlyActive.expenseParticipants[payerIndex] || "",
            receiptLineItems
        };
    };

    //#endregion


    //#region Overwriting active receipt at it's index

    const overwriteActiveReceipt = async (updatedReceipt) => {
        const receiptIndex =
            expenseCurrentlyActive.expenseReceipts.indexOf(receiptCurrentlyActive);

        if (receiptIndex < 0) {
            throw new Error("The active receipt is not part of this expense.");
        }

        updatedReceipt = {
            ...updatedReceipt,
            ...getReceiptCurrentlyActiveDetails()
        };

        const updatedReceipts = [...expenseCurrentlyActive.expenseReceipts];
        updatedReceipts[receiptIndex] = updatedReceipt;

        const updatedExpense = {
            ...expenseCurrentlyActive,
            expenseReceipts: updatedReceipts
        };

        await persistExpense(updatedExpense);

        expenseCurrentlyActive = updatedExpense;
        receiptCurrentlyActive = updatedReceipt;
    };

    //#endregion


    //#region  Saving a new receipt at the end of the expense receipt list and loading it
 
    const scanReceiptWithTabScanner = async (file) => {
        const apiUrl = window.APP_CONFIG.proxyApiUrl;
        const formData = new FormData();
        formData.append("file", file);


        // TabScanner request method 

        const getResponse = async (url, options) => {
            const response = await fetch(url, options);
            const responseText = await response.text();
            let data;

            try {
                data = JSON.parse(responseText);
            } 
            
            catch {
                throw new Error(responseText || "The scanner returned an invalid response.");
            }

            if (!data || typeof data !== "object") {
                throw new Error("The scanner returned an invalid response.");
            }

            if (!response.ok) {
                throw new Error(
                    data.title || response.statusText
                );
            }

            return data;
        };


        let scanResult = await getResponse(`${apiUrl}/receipts`, {
            method: "POST",
            body: formData
        });

        for (let attempt = 0; attempt <= 60; attempt++) {
            const status = scanResult.status;
            console.log(scanResult);
            
            if (status === "failed") {
                throw new Error(
                    scanResult.title ||
                    "TabScanner could not read this receipt."
                );
            }

            if (Array.isArray(scanResult.result?.lineItems)) {
                return scanResult.result.lineItems.map(lineItem => ({
                    name: lineItem?.descClean || "",
                    price: lineItem?.lineTotal == null
                        ? ""
                        : String(lineItem.lineTotal),
                    participants: []
                }));
            }

            if (attempt === 60) {
                break;
            }

            const token = scanResult.token;
            if (!token) {
                throw new Error(scanResult.title || "The scanner response did not contain a receipt token.");
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
            
            scanResult = await getResponse(
                `${apiUrl}/receipts/${encodeURIComponent(token)}`
            );
        }

        throw new Error("Receipt scanning timed out. Please try again.");
    };

    const saveExpense = async (file, { useTabScanner = false } = {}) => {
        if (!file) return;

        if (!receiptNameInput.value.trim()) {
            receiptNameInput.classList.add("is-invalid");
            receiptNameInput.focus();
            receiptFileInput.value = "";
            return;
        }

        if (!file.type.startsWith("image/")) {
            receiptFileFeedback.textContent = "Choose an image!";
            receiptFileFeedback.hidden = false;
            receiptFileInput.value = "";
            return;
        }

        if (useTabScanner && !["image/jpeg", "image/png"].includes(file.type)) {
            receiptFileFeedback.textContent =
                "TabScanner supports JPG and PNG images only.";
            receiptFileFeedback.hidden = false;
            receiptFileInput.value = "";
            return;
        }

        receiptFileFeedback.hidden = true;

        if (useTabScanner) {
            receiptUploadOptions.hidden = true;
            receiptScannerLoading.hidden = false;
        }

        try {
            const scannedLineItems = useTabScanner
                ? await scanReceiptWithTabScanner(file)
                : null;
            const receiptDetails = getReceiptCurrentlyActiveDetails(file);
            const updatedReceipt = {
                ...receiptCurrentlyActive,
                ...receiptDetails,
                ...(scannedLineItems ? { receiptLineItems: scannedLineItems } : {})
            };

            const updatedExpense = {
                ...expenseCurrentlyActive,
                expenseReceipts: [
                    ...expenseCurrentlyActive.expenseReceipts,
                    updatedReceipt
                ]
            };

            await persistExpense(updatedExpense);

            expenseCurrentlyActive = updatedExpense;
            receiptCurrentlyActive = updatedReceipt;
            loadReceipt(receiptCurrentlyActive);
            modal.hide();
        } 
        
        catch (error) {
            console.log("Unable to save receipt:", error);
            receiptFileFeedback.textContent = useTabScanner
                ? `Receipt scanning failed: ${error.message}`
                : "The receipt could not be saved. Please select the file again.";
            receiptFileFeedback.hidden = false;
            receiptFileInput.value = "";
        }
        
        finally {
            if (useTabScanner) {
                receiptScannerLoading.hidden = true;
                receiptUploadOptions.hidden = false;
            }
        }
    };


    //#endregion

    
    //#region Opening receipt image picker logic

    const openReceiptFilePicker = () => {
        const isValid = !!receiptNameInput.value.trim();

        receiptNameInput.classList.toggle("is-invalid", !isValid);

        if (!isValid) {
            receiptNameInput.focus();
            return;
        }

        receiptFileInput.click();
    };

    let useTabScanner = false;
    localUploadButton.addEventListener("click", () => {
        useTabScanner = false;
        openReceiptFilePicker();
    });
    tabScannerButton.addEventListener("click", () => {
        useTabScanner = true;
        openReceiptFilePicker();
    });

    receiptNameInput.addEventListener("input", () => {
        if (receiptNameInput.value.trim()) {
            receiptNameInput.classList.remove("is-invalid");
        }
    });
    
    receiptFileInput.addEventListener("change", () => {
        const inputFileIndex = 0;
        saveExpense(receiptFileInput.files[inputFileIndex], { useTabScanner });
    });

    //#endregion


    // #region - Create lineItem in lineItemsList logic

    const expenseCreateButton = document.getElementById("expenseCreateButton");
    const expenseLineItemsList = document.getElementById("expenseLineItemsList");
    const narrowParticipantLabel = window.matchMedia("(max-width: 29rem)");

    const updateParticipantButtonLabel = (button, checkboxes) => {

        const selectedParticipants = Array.from(checkboxes)
            .filter(option => option.checked)
            .map(option => option.nextElementSibling.textContent);

        button.textContent = selectedParticipants.length
            ? selectedParticipants.join(", ")
            : narrowParticipantLabel.matches
                ? "Participants"
                : "Select participants";
    };

    const saveActiveReceiptChanges = () => {
        if (!expenseCurrentlyActive.expenseReceipts.includes(receiptCurrentlyActive)) {
            return;
        }

        overwriteActiveReceipt(receiptCurrentlyActive).catch(error => {
            console.log("Unable to update receipt details:", error);
        });
    };

    const addExpenseLineItem = (lineItem = {}) => {
        const expenseLineItem = document.createElement("div");
        expenseLineItem.classList.add("expense-line-item");        
    
        let participantsHTML = "";
        
        for (let i = 0; i < expenseCurrentlyActive.expenseParticipants.length; i++) {
            participantsHTML += `
                <label class="form-check">
                    <input class="form-check-input participant-option"
                        type="checkbox"
                        value="${i + 1}"
                    >
                    <span class="form-check-label">${expenseCurrentlyActive.expenseParticipants[i]}</span>
                </label>
            `;
        }

        expenseLineItem.innerHTML = `
            <input class="form-control line-item-name" type="text" placeholder="Expense name">
            <input class="form-control line-item-price" type="text" placeholder="Cost">

            <div class="dropdown">
                <button class="form-select text-start" type="button"
                        data-bs-toggle="dropdown" aria-expanded="false">
                    Select participants
                </button>

                <div class="dropdown-menu w-100 p-2">
                    ${participantsHTML}
                </div>
            </div>

            <button class="btn btn-outline-secondary removeExpenseButton"
                type="button" aria-label="Remove expense">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" class="bi bi-x-lg" viewBox="0 0 16 16">
                            <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/>
                        </svg>
            </button>        
        `;
        
        expenseLineItem.querySelector(".line-item-name").value = lineItem.name || "";
        expenseLineItem.querySelector(".line-item-price").value = lineItem.price || "";

        expenseLineItem.querySelector(".removeExpenseButton")
            .addEventListener("click", () => {
                expenseLineItem.remove();
                saveActiveReceiptChanges();
            });

        expenseLineItemsList.appendChild(expenseLineItem);

        const participantButton = expenseLineItem.querySelector(
            "button[data-bs-toggle='dropdown']"
        );

        const participantCheckboxes = expenseLineItem.querySelectorAll(
            ".participant-option"
        );

        const selectedParticipants = Array.isArray(lineItem.participants)
            ? lineItem.participants
            : [];
        participantCheckboxes.forEach(checkbox => {
            checkbox.checked = selectedParticipants.includes(
                checkbox.nextElementSibling.textContent.trim()
            );
            checkbox.addEventListener("change", () => {
                updateParticipantButtonLabel(participantButton, participantCheckboxes);
                saveActiveReceiptChanges();
            });
        });
        updateParticipantButtonLabel(participantButton, participantCheckboxes);

        expenseLineItem.querySelectorAll(".line-item-name, .line-item-price")
            .forEach(input => input.addEventListener("change", saveActiveReceiptChanges));
    };

    //#endregion
    

    //#region Loading receipt data logic

    const loadReceipt = (receipt, { openModal = false } = {}) => {
        receiptCurrentlyActive = receipt;
        receiptNameInput.value = receipt.receiptName || "";
        receiptNameInput.classList.remove("is-invalid");
        receiptFileInput.value = "";
        receiptFileFeedback.hidden = true;

        const expenseTitle = document.getElementById("expenseTitle");
        expenseTitle.innerText = `Proceeding: ${receipt.receiptName} `;


        const payerIndex = expenseCurrentlyActive.expenseParticipants
            .indexOf(receipt.receiptPayer);
        expenseSelectPayer.value = payerIndex >= 0
            ? String(payerIndex + 1)
            : "";

        expenseLineItemsList.replaceChildren();
        const lineItems = Array.isArray(receipt.receiptLineItems)
            ? receipt.receiptLineItems
            : [];
        if (lineItems.length) {
            lineItems.forEach(addExpenseLineItem);
        } else {
            addExpenseLineItem();
        }

        if (receipt.receiptImg instanceof Blob) {
            const previewUrl = URL.createObjectURL(receipt.receiptImg);
            const expenseImg = document.createElement("img");
            expenseImg.src = previewUrl;
            expenseImg.alt = receipt.receiptName || "Receipt";
            expenseImageContainer.replaceChildren(expenseImg);
        } else {
            expenseImageContainer.textContent = "Receipt image is unavailable.";
        }

        if (openModal) {
            modal.show();
        }
    };

    narrowParticipantLabel.addEventListener("change", () => {
        expenseLineItemsList.querySelectorAll(".expense-line-item").forEach(lineItem => {
            const participantButton = lineItem.querySelector(
                "button[data-bs-toggle='dropdown']"
            );
            const participantCheckboxes = lineItem.querySelectorAll(".participant-option");

            updateParticipantButtonLabel(participantButton, participantCheckboxes);
        });
    });

    expenseCreateButton.addEventListener("click", () => {
        addExpenseLineItem();
        saveActiveReceiptChanges();
    });

    //#endregion


    //#region Creating new receipt logic

    const createReceipt = () => {
        loadReceipt({
            receiptName: "",
            receiptImg: "",
            receiptPayer: "",
            receiptLineItems: []
        }, { openModal: true });
    };

    receiptUploadNew.addEventListener("click", createReceipt);

    //#endregion


    //#region Removing entire active expense and returning to index.html

    const removeExpense = async () => {
        const transaction = dbConnection.transaction(dbStoreObject, "readwrite");
        transaction.objectStore(dbStoreObject).delete(expenseId);

        await new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });

        sessionStorage.removeItem("expenseCurrentlyActive");
        window.location.replace("../index.html");
    };

    //#endregion


    //#region Removing active receipt and loading first available

    const removeReceipt = async () => {
        receiptDeleteButton.disabled = true;

        try {
            const receiptIndex =
                expenseCurrentlyActive.expenseReceipts.indexOf(receiptCurrentlyActive);

            const firstReceiptIndex = 0;

            // if there is no receiptCurrentlyActive obj in expenseCurrentlyActive.expenseReceipts list
            // it returns -1
            // it means that if there is no receipt which user wants to remove then do this code below

            if (receiptIndex < 0) {
                if (expenseCurrentlyActive.expenseReceipts.length === 0) {
                    await removeExpense();
                    return;
                }

                loadReceipt(expenseCurrentlyActive.expenseReceipts[firstReceiptIndex]);
                return;
            }

            const updatedReceipts = [...expenseCurrentlyActive.expenseReceipts];

            const numberOfReceiptsToRemove = 1;
            updatedReceipts.splice(receiptIndex, numberOfReceiptsToRemove);

            if (updatedReceipts.length === 0) {
                await removeExpense();
                return;
            }

            const updatedExpense = {
                ...expenseCurrentlyActive,
                expenseReceipts: updatedReceipts
            };

            await persistExpense(updatedExpense);
            expenseCurrentlyActive = updatedExpense;
            loadReceipt(updatedReceipts[firstReceiptIndex]);
        } catch (error) {
            console.log("Unable to remove receipt:", error);
        } finally {
            receiptDeleteButton.disabled = false;
        }
    };

    receiptDeleteButton.addEventListener("click", removeReceipt);

    //#endregion


    //#region Loading first receipt or creating new one
      
    // Logic below decides to whether load very first receipt, or create any if there is none
    

    if (receiptCurrentlyActive) {
        loadReceipt(receiptCurrentlyActive, {
            openModal: !(receiptCurrentlyActive.receiptImg instanceof Blob)
        });
    } else {
        createReceipt();
    }

    //#endregion


    //#region TODO: Updating currently receipt in the DB 
    
    
    expenseSelectPayer.addEventListener("change", saveActiveReceiptChanges);

    //#endregion


    //#region Switch receipt logic


    const showReceiptModal = () => {
        const expenseReceipts = Array.isArray(expenseCurrentlyActive.expenseReceipts)
            ? expenseCurrentlyActive.expenseReceipts
            : [];

        const modalElement = document.createElement("div");

        modalElement.className = "modal fade";
        modalElement.tabIndex = -1;

        modalElement.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">

                    <div class="modal-header border-0">
                        <h5 class="modal-title">Switch receipt to:</h5>
                        <button
                            type="button"
                            class="btn-close"
                            data-bs-dismiss="modal"
                            aria-label="Close">
                        </button>
                    </div>

                    <div class="modal-body">
                        <select class="form-select" id="receiptSelect">
                            <option value="" selected disabled>Select a receipt</option>
                        </select>

                        <div
                            class="text-danger small mt-2"
                            id="receiptSelectFeedback"
                            hidden>
                        </div>
                    </div>

                </div>
            </div>
        `;

        const receiptSelect = modalElement.querySelector("#receiptSelect");
        const selectionFeedback = modalElement.querySelector("#receiptSelectFeedback");

        expenseReceipts.forEach((receipt, index) => {
            const option = document.createElement("option");

            option.value = index;
            option.textContent = receipt.receiptName || `Receipt ${index + 1}`;

            receiptSelect.appendChild(option);
        });

        document.body.appendChild(modalElement);

        const modal = new bootstrap.Modal(modalElement, {
            backdrop: true,
            keyboard: true
        });

        let isSwitching = false;

        receiptSelect.addEventListener("change", async () => {
            if (isSwitching || receiptSelect.value === "") {
                return;
            }

            const selectedReceipt = expenseReceipts[Number(receiptSelect.value)];

            if (!selectedReceipt) {
                return;
            }

            isSwitching = true;
            receiptSelect.disabled = true;
            selectionFeedback.hidden = true;

            try {
                if (expenseCurrentlyActive.expenseReceipts.includes(receiptCurrentlyActive)) {
                    await overwriteActiveReceipt(receiptCurrentlyActive);
                }

                loadReceipt(selectedReceipt);
                modal.hide();
            }
            
            catch (error) {
                console.log("Unable to switch receipt:", error);

                selectionFeedback.textContent =
                    "Could not switch receipts. Please try again.";
                selectionFeedback.hidden = false;

                receiptSelect.disabled = false;
                receiptSelect.value = "";
                isSwitching = false;
            }
        });

        modalElement.addEventListener("hidden.bs.modal", () => {
            modal.dispose();
            modalElement.remove();
        });

        modal.show();
    };

    const receiptSwitchButton = document.getElementById("receiptSwitchButton");
    receiptSwitchButton.addEventListener("click", showReceiptModal);



    //#endregion


    //#region Expense summary

    const expenseGetSummaryButton = document.getElementById("expenseGetSummaryButton");


    const expenseGetSummary = async () => {

        // Saving actual receipt

        try {
            if (expenseCurrentlyActive.expenseReceipts.includes(receiptCurrentlyActive)) {
                await overwriteActiveReceipt(receiptCurrentlyActive);
            }
        } catch (error) {
            console.log("Unable to save receipt details before showing the summary:", error);
            window.alert("Could not save the current receipt details. Please try again.");
            return;
        }

        // Modal content creation

        const summaryModalElement = document.createElement("div");
        summaryModalElement.className = "modal fade";
        summaryModalElement.tabIndex = -1;
        summaryModalElement.setAttribute("aria-labelledby", "expenseSummaryTitle");
        summaryModalElement.setAttribute("aria-hidden", "true");
        summaryModalElement.innerHTML = `
            <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content border-secondary">
                    <div class="modal-header bg-dark text-white">
                        <h2 class="modal-title fs-5" id="expenseSummaryTitle">
                            Expense summary
                        </h2>
                        <button type="button" class="btn-close btn-close-white"
                                data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body bg-light">
                        <div id="expenseDebtSummary"
                             class="alert alert-secondary border border-dark mb-3">
                        </div>
                        <div class="table-responsive">
                            <table class="table table-striped table-hover table-bordered align-middle mb-0">
                                <thead class="table-dark">
                                    <tr>
                                        <th scope="col">Item</th>
                                        <th scope="col">Cost</th>
                                        <th scope="col">Item Participants</th>
                                        <th scope="col">Payer</th>
                                        <th scope="col">Receipt</th>
                                    </tr>
                                </thead>
                                
                                <tbody>
                                
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-footer bg-white">
                        <button type="button" class="btn btn-dark"
                                data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        `;



        // Table content creation 

        const summaryTableBody = summaryModalElement.querySelector("tbody");
        const summaryRows = [];
        expenseCurrentlyActive.expenseReceipts.forEach((receipt, receiptIndex) => {
            const lineItems = Array.isArray(receipt.receiptLineItems)
                ? receipt.receiptLineItems
                : [];
            const receiptName = receipt.receiptName || `Receipt ${receiptIndex + 1}`;

            if (lineItems.length === 0) {
                summaryRows.push({
                    item: "—",
                    cost: "—",
                    participants: "—",
                    payer: receipt.receiptPayer || "—",
                    receiptName
                });
                return;
            }

            lineItems.forEach(lineItem => {
                summaryRows.push({
                    item: lineItem.name || "—",
                    cost: lineItem.price === "" || lineItem.price == null
                        ? "—"
                        : lineItem.price,
                    participants: Array.isArray(lineItem.participants) &&
                        lineItem.participants.length
                        ? lineItem.participants.join(", ")
                        : "—",
                    payer: receipt.receiptPayer || "—",
                    receiptName
                });
            });
        });


        // Creating each participant's balance
             

        const balances = new Map();
        let excludedItems = 0;
        expenseCurrentlyActive.expenseReceipts.forEach(receipt => {
            const payer = typeof receipt.receiptPayer === "string"
                ? receipt.receiptPayer.trim()
                : "";
            const lineItems = Array.isArray(receipt.receiptLineItems)
                ? receipt.receiptLineItems
                : [];
            lineItems.forEach(lineItem => {
                const price = String(lineItem.price ?? "").trim().replace(",", ".");
                const convertedPrice = Number(price);

                /*
                    This scary looking code below just re-writes all line item participants
                    but it trims each participant name and writes only unique values to prevent copy.

                    Also it removes false values like empty strings
                */

                const lineItemParticipants = [...new Set(
                    (Array.isArray(lineItem.participants) ? lineItem.participants : [])
                        .filter(participant => typeof participant === "string")
                        .map(participant => participant.trim())
                        .filter(Boolean) // it removes false values like empty strings
                )];


                // It tests whether the value is a non-negative number with an optional 
                // decimal part containing 1 to 2 digits after a comma or a period.

                // Also it checks whether the normalized price is a finite number
                 
                if (!/^\d+(?:[.,]\d{1,2})?$/.test(price) ||
                    !Number.isFinite(convertedPrice) || convertedPrice < 0 ||
                    !payer || lineItemParticipants.length === 0) {
                    excludedItems++;
                    return;
                }                


                // Line item price converted to cents
                

                const cents = Math.round(convertedPrice * 100);
                if (!Number.isSafeInteger(cents)) {
                    excludedItems++;
                    return;
                }

                
                const sharedLineItemPrice = Math.floor(cents / lineItemParticipants.length);
                

                // Primarly add entire lineItem cost to payer's balance 
                balances.set(payer, (balances.get(payer) || 0) + cents);

                // Counting debts and adding to participants balances
                lineItemParticipants.forEach((participant, index) => {
                    balances.set(
                        participant,
                        (balances.get(participant) || 0) - sharedLineItemPrice -
                            (index < cents % lineItemParticipants.length ? 1 : 0)
                    );
                });
            });
        });


        console.log("balances after calculating each line item in each receipt: ");        
        console.log(balances);       


        // List of participants where balance > 0
        

        const creditors = [...balances]
            .filter(([, balance]) => balance > 0)
            .map(([name, remaining]) => ({ name, remaining }));

        console.log("creditors: ");        
        console.log(JSON.stringify(creditors));
        

        // List of participants where balance < 0

        const debtors = [...balances]
            .filter(([, balance]) => balance < 0)
            .map(([name, balance]) => ({ name, remaining: -balance }));

        console.log("debtors: ");        
        console.log(JSON.stringify(debtors));


        const debtSummary = summaryModalElement.querySelector("#expenseDebtSummary");
        const debtSummaryTitle = document.createElement("h3");
        debtSummaryTitle.className = "h6 text-dark";
        debtSummaryTitle.textContent = "Who owes whom?";
        debtSummary.appendChild(debtSummaryTitle);

        const settlementList = document.createElement("ul");
        settlementList.className = "list-unstyled mb-0";

        
        // Zeroing out balances 
                 
        debtors.forEach(debtor => {
            creditors.forEach(creditor => {
                console.log(`${creditor.name} = ${creditor.remaining}`);
                const amount = Math.min(debtor.remaining, creditor.remaining);
                if (amount === 0) {
                    return;
                }

                const settlementItem = document.createElement("li");
                settlementItem.textContent =
                    `${debtor.name} owes ${creditor.name}: ${(amount / 100).toFixed(2)}`;
                settlementList.appendChild(settlementItem);
                debtor.remaining -= amount;
                creditor.remaining -= amount;

                console.log(`${creditor.name} = ${creditor.remaining}`);
                
            });
        });

        if (settlementList.childElementCount === 0) {
            const noDebtsMessage = document.createElement("li");
            noDebtsMessage.textContent = "No outstanding payments.";
            settlementList.appendChild(noDebtsMessage);
        }
        debtSummary.appendChild(settlementList);

        if (excludedItems > 0) {
            const excludedItemsNotice = document.createElement("p");
            excludedItemsNotice.className = "small text-secondary mt-2 mb-0";
            excludedItemsNotice.textContent =
                `${excludedItems} item(s) excluded because the cost, payer, ` +
                "or item participants were missing or invalid.";
            debtSummary.appendChild(excludedItemsNotice);
        }

        if (summaryRows.length === 0) {
            const emptyRow = document.createElement("tr");
            const emptyCell = document.createElement("td");
            emptyCell.colSpan = 5;
            emptyCell.className = "text-center text-secondary py-4";
            emptyCell.textContent = "No receipts or items to display.";
            emptyRow.appendChild(emptyCell);
            summaryTableBody.appendChild(emptyRow);
        }
        
        else {
            summaryRows.forEach(row => {
                const tableRow = document.createElement("tr");
                [row.item, row.cost, row.participants, row.payer, row.receiptName]
                    .forEach(value => {
                        const cell = document.createElement("td");
                        cell.textContent = String(value);
                        tableRow.appendChild(cell);
                    });
                summaryTableBody.appendChild(tableRow);
            });
        }

        document.body.appendChild(summaryModalElement);

        const summaryModal = new bootstrap.Modal(summaryModalElement);
        summaryModalElement.addEventListener("hidden.bs.modal", () => {
            summaryModal.dispose();
            summaryModalElement.remove();
        }, { once: true });
        summaryModal.show();
    };


    expenseGetSummaryButton.addEventListener("click", expenseGetSummary)

    //#endregion


    //#region - Return to index button

    const returnToIndexButton = document.getElementById("returnToIndexButton");
    returnToIndexButton.addEventListener("click", () => {
        window.location.replace("../index.html");
    })

    //#endregion
}

const STORAGE_KEY = "mishitza-state";
const DRAG_HOLD_DURATION_MS = 100;
const EDIT_HOLD_DURATION_MS = 1000;
const DRAG_START_DISTANCE_PX = 10;

const app = document.getElementById("app");
const dialogRoot = document.getElementById("dialog-root");
const homeTemplate = document.getElementById("home-screen-template");
const workoutTemplate = document.getElementById("workout-screen-template");
const stopwatchStore = {};
const HOME_EXERCISE_TABS = ["upper", "lower", "core"];
const HOME_TABS = [...HOME_EXERCISE_TABS, "workout"];
let activeHomeTab = "upper";
let activeStopwatchIntervalId = null;
let completeMessageTimeoutId = null;

const state = loadState();

registerServiceWorker();
initializeHistory();
render();

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    return createEmptyState();
  }

  try {
    return normalizeState(JSON.parse(saved));
  } catch {
    return createEmptyState();
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // PWA installability is optional; the app should still work without registration.
    });
  });
}

function initializeHistory() {
  window.addEventListener("popstate", (event) => {
    const leavingWorkoutId = state.currentWorkoutId;
    const nextWorkoutId = event.state?.workoutId ?? null;

    if (leavingWorkoutId && !nextWorkoutId) {
      const workout = state.workouts.find((entry) => entry.id === leavingWorkoutId);

      if (workout && isWorkoutComplete(workout)) {
        resetAllWorkoutProgress();
      }
    }

    state.currentWorkoutId = event.state?.workoutId ?? null;
    saveState();
    render();
  });

  history.replaceState({ workoutId: null }, "", buildUrl(null));

  if (state.currentWorkoutId) {
    history.pushState(
      { workoutId: state.currentWorkoutId },
      "",
      buildUrl(state.currentWorkoutId)
    );
  }
}

function buildUrl(workoutId) {
  const base = `${window.location.pathname}${window.location.search}`;
  return workoutId ? `${base}#workout=${encodeURIComponent(workoutId)}` : base;
}

function openWorkout(workoutId) {
  state.currentWorkoutId = workoutId;
  saveState();
  history.pushState({ workoutId }, "", buildUrl(workoutId));
  render();
}

function goHome() {
  if (history.state?.workoutId) {
    history.back();
    return;
  }

  state.currentWorkoutId = null;
  saveState();
  history.replaceState({ workoutId: null }, "", buildUrl(null));
  render();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function createEmptyState() {
  return {
    exercises: [],
    workouts: [],
    selectedExerciseIds: [],
    myWorkoutExerciseIds: [],
    selectedMyWorkoutExerciseIds: [],
    currentWorkoutId: null,
    lastCompletedWorkoutId: null,
  };
}

function normalizeExerciseCategory(value) {
  const category = String(value ?? "").toLowerCase();
  return HOME_EXERCISE_TABS.includes(category) ? category : "upper";
}

function formatHomeTabTitle(tab) {
  return String(tab ?? "upper").toUpperCase();
}

function reorderExercisesWithinCategory(category, orderedIds) {
  const reordered = reorderCollectionByIds(
    state.exercises.filter((exercise) => exercise.category === category),
    orderedIds
  );
  let index = 0;

  state.exercises = state.exercises.map((exercise) => (
    exercise.category === category ? reordered[index++] : exercise
  ));
}

function moveExerciseToTopOfCategory(exerciseId) {
  const exercise = state.exercises.find((entry) => entry.id === exerciseId);

  if (!exercise) {
    return;
  }

  const reordered = [
    exercise,
    ...state.exercises.filter((entry) => entry.category === exercise.category && entry.id !== exerciseId),
  ];
  let index = 0;

  state.exercises = state.exercises.map((entry) => (
    entry.category === exercise.category ? reordered[index++] : entry
  ));
}

function normalizeState(parsed) {
  const normalizeExercise = (exercise) => ({
    id: exercise.id || crypto.randomUUID(),
    name: exercise.name ?? "",
    max: exercise.max ?? exercise.reps ?? "",
    category: normalizeExerciseCategory(exercise.category),
    checked: Boolean(exercise.checked),
    lastCompletedAt: exercise.lastCompletedAt ?? null,
  });

  const workouts = Array.isArray(parsed.workouts)
    ? parsed.workouts.map((workout) => ({
        id: workout.id || crypto.randomUUID(),
        title: workout.title ?? "",
        exercises: Array.isArray(workout.exercises)
          ? workout.exercises.map(normalizeExercise)
          : [],
        lastCompletedAt: workout.lastCompletedAt ?? null,
      }))
    : [];

  const workoutExercises = workouts.flatMap((workout) => workout.exercises.map((exercise) => ({
    ...exercise,
    checked: false,
  })));

  const exercises = Array.isArray(parsed.exercises) && parsed.exercises.length > 0
    ? parsed.exercises.map(normalizeExercise)
    : workoutExercises;

  const exerciseIds = new Set(exercises.map((exercise) => exercise.id));
  const normalizeExerciseIds = (values) => [...new Set(
    (Array.isArray(values) ? values : []).filter((id) => exerciseIds.has(id))
  )];
  const myWorkoutExerciseIds = normalizeExerciseIds(parsed.myWorkoutExerciseIds);

  return {
    exercises,
    workouts,
    selectedExerciseIds: normalizeExerciseIds(parsed.selectedExerciseIds),
    myWorkoutExerciseIds,
    selectedMyWorkoutExerciseIds: normalizeExerciseIds(parsed.selectedMyWorkoutExerciseIds)
      .filter((id) => myWorkoutExerciseIds.includes(id)),
    currentWorkoutId: parsed.currentWorkoutId ?? null,
    lastCompletedWorkoutId: parsed.lastCompletedWorkoutId ?? null,
  };
}

function replaceState(nextState) {
  state.exercises = nextState.exercises;
  state.workouts = nextState.workouts;
  state.selectedExerciseIds = nextState.selectedExerciseIds;
  state.myWorkoutExerciseIds = nextState.myWorkoutExerciseIds;
  state.selectedMyWorkoutExerciseIds = nextState.selectedMyWorkoutExerciseIds;
  state.currentWorkoutId = nextState.currentWorkoutId;
  state.lastCompletedWorkoutId = nextState.lastCompletedWorkoutId;
}

function exportStateToJson() {
  const backup = {
    exercises: state.exercises,
    workouts: state.workouts,
    selectedExerciseIds: state.selectedExerciseIds,
    myWorkoutExerciseIds: state.myWorkoutExerciseIds,
    selectedMyWorkoutExerciseIds: state.selectedMyWorkoutExerciseIds,
    lastCompletedWorkoutId: state.lastCompletedWorkoutId,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date();
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  link.href = url;
  link.download = `mishitza-backup-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function render() {
  app.innerHTML = "";

  if (state.currentWorkoutId) {
    renderWorkoutScreen(state.currentWorkoutId);
    return;
  }

  renderHomeScreen();
}

function renderHomeScreen() {
  const fragment = homeTemplate.content.cloneNode(true);
  const subtitle = fragment.getElementById("home-screen-subtitle");
  const title = fragment.getElementById("home-screen-title");
  const formCard = fragment.getElementById("workout-form-card");
  const showFormButton = fragment.getElementById("show-exercise-form");
  const addAction = fragment.getElementById("home-add-action");
  const saveExerciseButton = fragment.getElementById("save-exercise");
  const cancelExerciseButton = fragment.getElementById("cancel-home-exercise");
  const exerciseNameInput = fragment.getElementById("exercise-name-input");
  const exerciseMaxInput = fragment.getElementById("exercise-max-input");
  const exerciseList = fragment.getElementById("exercise-list");
  const selectedExercisesAction = fragment.getElementById("selected-exercises-action");
  const addSelectedToWorkoutButton = fragment.getElementById("add-selected-to-workout");
  const clearSelectedExercisesButton = fragment.getElementById("clear-selected-exercises");
  const myWorkoutScreen = fragment.getElementById("my-workout-screen");
  const myWorkoutList = fragment.getElementById("my-workout-list");
  const completeMyWorkoutButton = fragment.getElementById("complete-my-workout");
  const clearMyWorkoutSelectionButton = fragment.getElementById("clear-my-workout-selection");
  const homeStopwatchPopover = fragment.getElementById("home-stopwatch-popover");
  const homeStopwatchTime = fragment.getElementById("home-stopwatch");
  const toggleHomeStopwatchButton = fragment.getElementById("toggle-home-stopwatch");
  const resetHomeStopwatchButton = fragment.getElementById("reset-home-stopwatch");
  const stopwatchPopoverButton = fragment.getElementById("toggle-home-stopwatch-popover");
  const stopwatchFloat = fragment.querySelector(".stopwatch-float");
  const navButtons = [...fragment.querySelectorAll("[data-home-tab]")];
  const exerciseTabButtons = navButtons.filter((button) => HOME_EXERCISE_TABS.includes(button.dataset.homeTab));
  const homeLinks = fragment.getElementById("home-links");
  const exportButton = fragment.getElementById("export-data");
  const importButton = fragment.getElementById("import-data");
  const importFileInput = fragment.getElementById("import-file-input");
  const isMyWorkoutTab = activeHomeTab === "workout";

  subtitle.textContent = "MISHITZA WORKOUT TRACKER";
  title.textContent = isMyWorkoutTab ? "MY WORKOUT" : formatHomeTabTitle(activeHomeTab);

  navButtons.forEach((button) => {
    const tab = button.dataset.homeTab;
    const isActive = tab === activeHomeTab;
    button.classList.toggle("nav-tab-active", isActive);
    button.setAttribute("aria-current", isActive ? "page" : "false");
    button.addEventListener("click", () => {
      if (tab === activeHomeTab) {
        return;
      }

      activeHomeTab = HOME_TABS.includes(tab) ? tab : "upper";
      render();
    });
  });

  bindStopwatch("home", homeStopwatchTime, toggleHomeStopwatchButton, resetHomeStopwatchButton);
  stopwatchFloat.classList.toggle(
    "stopwatch-float-raised",
    isMyWorkoutTab || state.selectedExerciseIds.length > 0
  );
  stopwatchPopoverButton.addEventListener("click", () => {
    const isOpen = !homeStopwatchPopover.classList.contains("hidden");
    homeStopwatchPopover.classList.toggle("hidden", isOpen);
    stopwatchPopoverButton.setAttribute("aria-expanded", String(!isOpen));
  });

  if (isMyWorkoutTab) {
    exerciseList.classList.add("hidden");
    addAction.classList.add("hidden");
    homeLinks.classList.add("hidden");
    selectedExercisesAction.classList.add("hidden");
    myWorkoutScreen.classList.remove("hidden");
    renderMyWorkoutList(myWorkoutList);

    const myWorkoutExercises = getMyWorkoutExercises();
    const hasMyWorkoutSelection = state.selectedMyWorkoutExerciseIds.length > 0;
    completeMyWorkoutButton.classList.toggle("hidden", myWorkoutExercises.length === 0);
    completeMyWorkoutButton.textContent = hasMyWorkoutSelection ? "Remove exercise" : "Workout complete";
    clearMyWorkoutSelectionButton.classList.toggle("hidden", !hasMyWorkoutSelection);
    completeMyWorkoutButton.addEventListener("click", () => {
      if (hasMyWorkoutSelection) {
        showConfirmDialog({
          title: "Are you sure?",
          message: "This will remove the selected exercise from your workout.",
          confirmLabel: "Yes",
          cancelLabel: "No",
          onConfirm: removeSelectedMyWorkoutExercises,
        });
        return;
      }

      showConfirmDialog({
        title: "Are you sure?",
        message: "This will complete your workout.",
        confirmLabel: "Yes",
        cancelLabel: "No",
        onConfirm: completeMyWorkout,
      });
    });
    clearMyWorkoutSelectionButton.addEventListener("click", () => {
      state.selectedMyWorkoutExerciseIds = [];
      saveState();
      render();
    });
  } else {
    exerciseList.classList.remove("hidden");
    addAction.classList.remove("hidden");
    homeLinks.classList.remove("hidden");
    myWorkoutScreen.classList.add("hidden");
    selectedExercisesAction.classList.toggle("hidden", state.selectedExerciseIds.length === 0);
  }

  showFormButton.addEventListener("click", () => {
    document.addEventListener("click", handleOutsideExerciseForm);
    formCard.classList.remove("hidden");
    exerciseNameInput.focus();
    scrollIntoViewAfterKeyboard(formCard);
  });

  const submitExercise = () => {
    const name = exerciseNameInput.value.trim();
    const max = exerciseMaxInput.value.trim();

    if (!name) {
      exerciseNameInput.focus();
      return;
    }

    if (!max) {
      exerciseMaxInput.focus();
      return;
    }

    state.exercises.push({
      id: crypto.randomUUID(),
      name,
      max,
      category: activeHomeTab,
      checked: false,
      lastCompletedAt: null,
    });

    closeExerciseForm();
    saveState();
    render();
  };

  saveExerciseButton.addEventListener("click", submitExercise);
  cancelExerciseButton.addEventListener("click", (event) => {
    event.stopPropagation();
    closeExerciseForm();
  });
  exerciseNameInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    exerciseMaxInput.focus();
  });
  exerciseMaxInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    submitExercise();
  });
  exerciseNameInput.addEventListener("focus", () => {
    scrollIntoViewAfterKeyboard(formCard);
  });
  exerciseMaxInput.addEventListener("focus", () => {
    scrollIntoViewAfterKeyboard(formCard);
  });
  exerciseNameInput.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  exerciseMaxInput.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  saveExerciseButton.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  cancelExerciseButton.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  exportButton.addEventListener("click", exportStateToJson);
  importButton.addEventListener("click", () => {
    importFileInput.click();
  });
  importFileInput.addEventListener("change", async () => {
    const [file] = importFileInput.files || [];

    if (!file) {
      return;
    }

    try {
      const imported = normalizeState(JSON.parse(await file.text()));
      replaceState(imported);
      saveState();
      render();
    } catch {
      showConfirmDialog({
        title: "Import failed",
        message: "Please choose a valid Mishitza JSON backup.",
        confirmLabel: "OK",
        onConfirm: () => {},
      });
    } finally {
      importFileInput.value = "";
    }
  });

  addSelectedToWorkoutButton.addEventListener("click", () => {
    addSelectedExercisesToMyWorkout();
  });
  clearSelectedExercisesButton.addEventListener("click", () => {
    state.selectedExerciseIds = [];
    saveState();
    render();
  });

  if (!isMyWorkoutTab) {
    const visibleExercises = state.exercises.filter((exercise) => exercise.category === activeHomeTab);

    if (visibleExercises.length === 0) {
      exerciseList.innerHTML = `<div class="empty-state">No ${activeHomeTab} exercises yet. Add one to get started.</div>`;
    } else {
      visibleExercises.forEach((exercise) => {
        const item = document.createElement("div");
        const isSelected = state.selectedExerciseIds.includes(exercise.id);
        item.className = `exercise-item${isSelected ? " selected-for-workout" : ""}`;
        item.dataset.exerciseId = exercise.id;
        item.setAttribute("role", "button");
        item.setAttribute("tabindex", "0");

        const label = document.createElement("div");
        label.className = "exercise-label home-exercise-label";

        const primary = document.createElement("div");
        primary.className = "home-exercise-primary";

        const name = document.createElement("span");
        name.className = "exercise-name";
        name.textContent = exercise.name;

        const max = document.createElement("span");
        max.className = "exercise-max";
        max.textContent = exercise.max || "";

        primary.append(name, max);

        const history = document.createElement("span");
        history.className = `exercise-history${exercise.lastCompletedAt ? "" : " exercise-history-new"}`;
        history.textContent = exercise.lastCompletedAt ? formatCompletionDate(exercise.lastCompletedAt) : "NEW";

        label.append(primary, history);

        const checkmark = document.createElement("span");
        checkmark.className = "checkmark";
        checkmark.textContent = isSelected ? "✓" : "";

        const externalLinkButton = createExerciseLinkButton(exercise.name);

        const grip = document.createElement("span");
        grip.className = "drag-grip";
        grip.setAttribute("aria-label", "Reorder exercise");
        grip.innerHTML = `
          <span class="drag-grip-dots" aria-hidden="true">
            <span></span><span></span>
            <span></span><span></span>
            <span></span><span></span>
          </span>
        `;

        item.append(checkmark, label, externalLinkButton, grip);

        item.addEventListener("click", () => {
          if (item.querySelector(".inline-item-editor")) {
            return;
          }

          toggleHomeExerciseSelection(exercise.id);
        });

        item.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }

          if (item.querySelector(".inline-item-editor")) {
            return;
          }

          event.preventDefault();
          toggleHomeExerciseSelection(exercise.id);
        });

        attachHoldGesture(grip, {
          dragElement: item,
          container: exerciseList,
          itemSelector: ".exercise-item",
          dropTargets: exerciseTabButtons.map((button) => ({
            element: button,
            value: button.dataset.homeTab,
          })),
          onHold: () => {
            renderHomeExerciseEditor({
              item,
              exercise,
            });
          },
          onReorder: (orderedIds) => {
            reorderExercisesWithinCategory(activeHomeTab, orderedIds);
            saveState();
            render();
          },
          onExternalDrop: (targetCategory) => {
            if (!HOME_EXERCISE_TABS.includes(targetCategory) || targetCategory === exercise.category) {
              return false;
            }

            exercise.category = targetCategory;
            moveExerciseToTopOfCategory(exercise.id);
            activeHomeTab = targetCategory;
            saveState();
            render();
            return true;
          },
        });

        exerciseList.appendChild(item);
      });
    }
  }

  app.appendChild(fragment);

  function closeExerciseForm() {
    formCard.classList.add("hidden");
    exerciseNameInput.value = "";
    exerciseMaxInput.value = "";
    document.removeEventListener("click", handleOutsideExerciseForm);
  }

  function handleOutsideExerciseForm(event) {
    if (formCard.classList.contains("hidden")) {
      document.removeEventListener("click", handleOutsideExerciseForm);
      return;
    }

    if (formCard.contains(event.target) || showFormButton.contains(event.target)) {
      return;
    }

    closeExerciseForm();
  }
}

function renderWorkoutScreen(workoutId) {
  const workout = state.workouts.find((entry) => entry.id === workoutId);

  if (!workout) {
    state.currentWorkoutId = null;
    saveState();
    render();
    return;
  }

  const fragment = workoutTemplate.content.cloneNode(true);
  const title = fragment.getElementById("workout-screen-title");
  const editTitleButton = fragment.getElementById("edit-workout-title");
  const titleEditInput = fragment.getElementById("workout-title-edit-input");
  const backButton = fragment.getElementById("back-home");
  const exerciseList = fragment.getElementById("exercise-list");
  const showExerciseFormButton = fragment.getElementById("show-exercise-form");
  const exerciseForm = fragment.getElementById("exercise-form");
  const exerciseNameInput = fragment.getElementById("exercise-name-input");
  const exerciseMaxInput = fragment.getElementById("exercise-max-input");
  const confirmAddExerciseButton = fragment.getElementById("confirm-add-exercise");
  const cancelAddExerciseButton = fragment.getElementById("cancel-add-exercise");
  const completeMessage = fragment.getElementById("workout-complete-message");
  const progressBar = fragment.getElementById("workout-progress-bar");
  const stopwatchTime = fragment.getElementById("workout-stopwatch");
  const toggleStopwatchButton = fragment.getElementById("toggle-stopwatch");
  const resetStopwatchButton = fragment.getElementById("reset-stopwatch");

  title.textContent = workout.title;
  titleEditInput.value = workout.title;
  progressBar.style.width = `${getWorkoutProgress(workout)}%`;
  bindStopwatch(workout.id, stopwatchTime, toggleStopwatchButton, resetStopwatchButton);

  let isEditingTitle = false;

  const saveWorkoutTitle = () => {
    if (!isEditingTitle) {
      return;
    }

    const nextTitle = titleEditInput.value.trim();

    if (nextTitle.length >= 3) {
      workout.title = nextTitle;
      title.textContent = nextTitle;
      saveState();
    } else {
      titleEditInput.value = workout.title;
    }

    isEditingTitle = false;
    title.classList.remove("hidden");
    editTitleButton.classList.remove("hidden");
    titleEditInput.classList.add("hidden");
  };

  editTitleButton.addEventListener("click", (event) => {
    event.stopPropagation();
    isEditingTitle = true;
    title.classList.add("hidden");
    editTitleButton.classList.add("hidden");
    titleEditInput.classList.remove("hidden");
    titleEditInput.value = workout.title;
    titleEditInput.focus();
    titleEditInput.select();

    window.setTimeout(() => {
      document.addEventListener("click", handleOutsideTitleSave);
    }, 0);
  });

  titleEditInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveWorkoutTitle();
      document.removeEventListener("click", handleOutsideTitleSave);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      titleEditInput.value = workout.title;
      saveWorkoutTitle();
      document.removeEventListener("click", handleOutsideTitleSave);
    }
  });

  titleEditInput.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  backButton.addEventListener("click", () => {
    document.removeEventListener("click", handleOutsideTitleSave);

    if (isWorkoutComplete(workout)) {
      resetAllWorkoutProgress();
    }

    goHome();
  });

  showExerciseFormButton.addEventListener("click", () => {
    document.addEventListener("click", handleOutsideExerciseForm);
    exerciseForm.classList.remove("hidden");
    exerciseNameInput.focus();
    scrollIntoViewAfterKeyboard(exerciseForm);
  });

  const submitExercise = () => {
    const name = exerciseNameInput.value.trim();
    const max = exerciseMaxInput.value.trim();

    if (!name) {
      exerciseNameInput.focus();
      return;
    }

    if (!max) {
      exerciseMaxInput.focus();
      return;
    }

    workout.exercises.push({
      id: crypto.randomUUID(),
      name,
      max,
      checked: false,
    });

    closeWorkoutExerciseForm();
    saveState();
    render();
  };

  confirmAddExerciseButton.addEventListener("click", submitExercise);
  cancelAddExerciseButton.addEventListener("click", (event) => {
    event.stopPropagation();
    closeWorkoutExerciseForm();
  });
  exerciseNameInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    exerciseMaxInput.focus();
  });
  exerciseMaxInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    submitExercise();
  });
  exerciseNameInput.addEventListener("focus", () => {
    scrollIntoViewAfterKeyboard(exerciseForm);
  });
  exerciseMaxInput.addEventListener("focus", () => {
    scrollIntoViewAfterKeyboard(exerciseForm);
  });
  exerciseNameInput.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  exerciseMaxInput.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  confirmAddExerciseButton.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  cancelAddExerciseButton.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  if (workout.exercises.length > 0) {
    workout.exercises.forEach((exercise) => {
      const item = document.createElement("div");
      item.className = `exercise-item${exercise.checked ? " checked" : ""}`;
      item.dataset.exerciseId = exercise.id;
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");

      const label = document.createElement("div");
      label.className = "exercise-label";

      const name = document.createElement("span");
      name.className = "exercise-name";
      name.textContent = exercise.name;

      const max = document.createElement("span");
      max.className = "exercise-max";
      max.textContent = exercise.max || "";

      label.append(name, max);

      const checkmark = document.createElement("span");
      checkmark.className = "checkmark";
      checkmark.textContent = exercise.checked ? "✓" : "";

      const grip = document.createElement("span");
      grip.className = "drag-grip";
      grip.setAttribute("aria-label", "Reorder exercise");
      grip.innerHTML = `
        <span class="drag-grip-dots" aria-hidden="true">
          <span></span><span></span>
          <span></span><span></span>
          <span></span><span></span>
        </span>
      `;

      const externalLinkButton = createExerciseLinkButton(exercise.name);

      item.append(checkmark, label, externalLinkButton, grip);

      item.addEventListener("click", () => {
        if (item.querySelector(".inline-item-editor")) {
          return;
        }

        exercise.checked = !exercise.checked;
        updateCompletionState(workout);
        saveState();
        syncExerciseItem(item, exercise, checkmark, name);
        syncWorkoutProgress(progressBar, completeMessage, workout);
      });

      item.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        if (item.querySelector(".inline-item-editor")) {
          return;
        }

        event.preventDefault();
        exercise.checked = !exercise.checked;
        updateCompletionState(workout);
        saveState();
        syncExerciseItem(item, exercise, checkmark, name);
        syncWorkoutProgress(progressBar, completeMessage, workout);
      });

      attachHoldGesture(grip, {
        dragElement: item,
        container: exerciseList,
        itemSelector: ".exercise-item",
        onHold: () => {
          renderExerciseEditor({
            item,
            exercise,
            workout,
            progressBar,
            completeMessage,
          });
        },
        onReorder: (orderedIds) => {
          workout.exercises = reorderCollectionByIds(workout.exercises, orderedIds);
          saveState();
          render();
        },
      });

      exerciseList.appendChild(item);
    });
  }

  if (isWorkoutComplete(workout)) {
    completeMessage.classList.remove("hidden");
  }

  app.appendChild(fragment);

  function handleOutsideTitleSave(event) {
    if (!isEditingTitle) {
      document.removeEventListener("click", handleOutsideTitleSave);
      return;
    }

    if (titleEditInput.contains(event.target) || editTitleButton.contains(event.target)) {
      return;
    }

    saveWorkoutTitle();
    document.removeEventListener("click", handleOutsideTitleSave);
  }

  function closeWorkoutExerciseForm() {
    exerciseForm.classList.add("hidden");
    exerciseNameInput.value = "";
    exerciseMaxInput.value = "";
    document.removeEventListener("click", handleOutsideExerciseForm);
  }

  function handleOutsideExerciseForm(event) {
    if (exerciseForm.classList.contains("hidden")) {
      document.removeEventListener("click", handleOutsideExerciseForm);
      return;
    }

    if (exerciseForm.contains(event.target) || showExerciseFormButton.contains(event.target)) {
      return;
    }

    closeWorkoutExerciseForm();
  }
}

function syncExerciseItem(item, exercise, checkmark, name) {
  item.classList.toggle("checked", exercise.checked);
  checkmark.textContent = exercise.checked ? "✓" : "";
  name.setAttribute("aria-checked", exercise.checked ? "true" : "false");
}

function createExerciseLinkButton(exerciseName) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "exercise-link-button";
  button.setAttribute("aria-label", `Search ${exerciseName} on YouTube`);
  button.innerHTML = `
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M4.75 6.5A2.25 2.25 0 0 1 7 4.25h8A2.25 2.25 0 0 1 17.25 6.5v2.05l3.14-2.52a1.35 1.35 0 0 1 2.19 1.05v9.84a1.35 1.35 0 0 1-2.19 1.05l-3.14-2.52v2.05A2.25 2.25 0 0 1 15 19.75H7a2.25 2.25 0 0 1-2.25-2.25v-11Z"/>
    </svg>
  `;

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const query = encodeURIComponent(exerciseName.trim());
    const url = `https://www.youtube.com/results?search_query=${query}`;
    window.open(url, "_blank", "noopener,noreferrer");
  });

  return button;
}

function toggleHomeExerciseSelection(exerciseId) {
  const selected = new Set(state.selectedExerciseIds);

  if (selected.has(exerciseId)) {
    selected.delete(exerciseId);
  } else {
    selected.add(exerciseId);
  }

  state.selectedExerciseIds = [...selected];
  saveState();
  render();
}

function addSelectedExercisesToMyWorkout() {
  const queued = new Set(state.myWorkoutExerciseIds);
  state.selectedExerciseIds.forEach((exerciseId) => queued.add(exerciseId));
  state.myWorkoutExerciseIds = [...queued];
  state.selectedExerciseIds = [];
  activeHomeTab = "workout";
  saveState();
  render();
}

function getMyWorkoutExercises() {
  const exercisesById = new Map(state.exercises.map((exercise) => [exercise.id, exercise]));
  return state.myWorkoutExerciseIds
    .map((exerciseId) => exercisesById.get(exerciseId))
    .filter(Boolean);
}

function renderMyWorkoutList(list) {
  const exercises = getMyWorkoutExercises();

  if (exercises.length === 0) {
    return;
  }

  exercises.forEach((exercise) => {
    const item = document.createElement("div");
    const isSelected = state.selectedMyWorkoutExerciseIds.includes(exercise.id);
    item.className = `exercise-item my-workout-item${isSelected ? " selected-for-workout" : ""}`;
    item.dataset.exerciseId = exercise.id;
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");

    const label = document.createElement("div");
    label.className = "exercise-label home-exercise-label";

    const primary = document.createElement("div");
    primary.className = "home-exercise-primary";

    const name = document.createElement("span");
    name.className = "exercise-name";
    name.textContent = exercise.name;

    const max = document.createElement("span");
    max.className = "exercise-max";
    max.textContent = exercise.max || "";

    const category = document.createElement("span");
    category.className = "exercise-history";
    category.textContent = exercise.category.toUpperCase();

    const grip = document.createElement("span");
    grip.className = "drag-grip";
    grip.setAttribute("aria-label", "Reorder workout exercise");
    grip.innerHTML = `
      <span class="drag-grip-dots" aria-hidden="true">
        <span></span><span></span>
        <span></span><span></span>
        <span></span><span></span>
      </span>
    `;

    primary.append(name, max);
    label.append(primary, category);
    const checkmark = document.createElement("span");
    checkmark.className = "checkmark";
    checkmark.textContent = isSelected ? "✓" : "";

    item.append(checkmark, label, createExerciseLinkButton(exercise.name), grip);

    item.addEventListener("click", () => {
      toggleMyWorkoutExerciseSelection(exercise.id);
    });

    item.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      toggleMyWorkoutExerciseSelection(exercise.id);
    });

    attachHoldGesture(grip, {
      dragElement: item,
      container: list,
      itemSelector: ".my-workout-item",
      onHold: () => {},
      onReorder: (orderedIds) => {
        state.myWorkoutExerciseIds = orderedIds;
        saveState();
        render();
      },
    });

    list.appendChild(item);
  });
}

function completeMyWorkout() {
  const completedExercises = getMyWorkoutExercises();

  if (completedExercises.length === 0) {
    state.myWorkoutExerciseIds = [];
    saveState();
    render();
    return;
  }

  const completedIds = new Set(completedExercises.map((exercise) => exercise.id));
  const completedAt = new Date().toISOString();

  state.exercises.forEach((exercise) => {
    if (completedIds.has(exercise.id)) {
      exercise.lastCompletedAt = completedAt;
    }
  });

  HOME_EXERCISE_TABS.forEach((category) => {
    const categoryExercises = state.exercises.filter((exercise) => exercise.category === category);
    const completed = categoryExercises.filter((exercise) => completedIds.has(exercise.id));
    const remaining = categoryExercises.filter((exercise) => !completedIds.has(exercise.id));
    const reordered = [...completed, ...remaining];
    let index = 0;

    state.exercises = state.exercises.map((exercise) => (
      exercise.category === category ? reordered[index++] : exercise
    ));
  });

  state.myWorkoutExerciseIds = [];
  state.selectedExerciseIds = [];
  state.selectedMyWorkoutExerciseIds = [];
  saveState();
  render();
}

function toggleMyWorkoutExerciseSelection(exerciseId) {
  const selected = new Set(state.selectedMyWorkoutExerciseIds);

  if (selected.has(exerciseId)) {
    selected.delete(exerciseId);
  } else {
    selected.add(exerciseId);
  }

  state.selectedMyWorkoutExerciseIds = [...selected];
  saveState();
  render();
}

function removeSelectedMyWorkoutExercises() {
  const selected = new Set(state.selectedMyWorkoutExerciseIds);
  state.myWorkoutExerciseIds = state.myWorkoutExerciseIds.filter((id) => !selected.has(id));
  state.selectedMyWorkoutExerciseIds = [];
  saveState();
  render();
}

function syncWorkoutProgress(progressBar, completeMessage, workout) {
  const completed = isWorkoutComplete(workout);

  // Delay the width update by a frame so the browser animates the fill
  // instead of jumping straight to the next value after a DOM rewrite.
  requestAnimationFrame(() => {
    progressBar.style.width = `${getWorkoutProgress(workout)}%`;
  });

  if (completed) {
    showWorkoutCompleteMessage(completeMessage);
    return;
  }

  hideWorkoutCompleteMessage(completeMessage);
}

function showWorkoutCompleteMessage(completeMessage) {
  if (completeMessageTimeoutId) {
    window.clearTimeout(completeMessageTimeoutId);
  }

  completeMessage.classList.remove("hidden");
  completeMessage.classList.remove("complete-message-visible");
  void completeMessage.offsetWidth;
  completeMessage.classList.add("complete-message-visible");

  completeMessageTimeoutId = window.setTimeout(() => {
    hideWorkoutCompleteMessage(completeMessage);
  }, 2000);
}

function hideWorkoutCompleteMessage(completeMessage) {
  if (completeMessageTimeoutId) {
    window.clearTimeout(completeMessageTimeoutId);
    completeMessageTimeoutId = null;
  }

  completeMessage.classList.remove("complete-message-visible");
  completeMessage.classList.add("hidden");
}

function getStopwatchEntry(workoutId) {
  if (!stopwatchStore[workoutId]) {
    stopwatchStore[workoutId] = {
      elapsedMs: 0,
      running: false,
      startedAt: null,
    };
  }

  return stopwatchStore[workoutId];
}

function bindStopwatch(workoutId, timeEl, toggleButton, resetButton) {
  const stopwatch = getStopwatchEntry(workoutId);

  if (activeStopwatchIntervalId) {
    window.clearInterval(activeStopwatchIntervalId);
    activeStopwatchIntervalId = null;
  }

  const renderStopwatch = () => {
    const elapsedMs = stopwatch.running && stopwatch.startedAt
      ? Date.now() - stopwatch.startedAt
      : stopwatch.elapsedMs;

    timeEl.textContent = formatStopwatchTime(elapsedMs);
    toggleButton.textContent = stopwatch.running ? "Stop" : "Start";
  };

  toggleButton.addEventListener("click", () => {
    if (stopwatch.running) {
      stopwatch.elapsedMs = Date.now() - stopwatch.startedAt;
      stopwatch.running = false;
      stopwatch.startedAt = null;

      if (activeStopwatchIntervalId) {
        window.clearInterval(activeStopwatchIntervalId);
        activeStopwatchIntervalId = null;
      }

      renderStopwatch();
      return;
    }

    stopwatch.running = true;
    stopwatch.startedAt = Date.now() - stopwatch.elapsedMs;
    renderStopwatch();
    activeStopwatchIntervalId = window.setInterval(renderStopwatch, 250);
  });

  resetButton.addEventListener("click", () => {
    stopwatch.elapsedMs = 0;

    if (stopwatch.running) {
      stopwatch.startedAt = Date.now();
    }

    renderStopwatch();
  });

  renderStopwatch();

  if (stopwatch.running) {
    activeStopwatchIntervalId = window.setInterval(renderStopwatch, 250);
  }
}

function formatStopwatchTime(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderExerciseEditor({ item, exercise, workout, progressBar, completeMessage }) {
  item.innerHTML = "";
  item.classList.remove("checked");
  item.removeAttribute("role");
  item.removeAttribute("tabindex");

  const editor = document.createElement("div");
  editor.className = "card workout-form exercise-form inline-item-editor";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 80;
  nameInput.placeholder = "Exercise name";
  nameInput.value = exercise.name;

  const maxInput = document.createElement("input");
  maxInput.type = "text";
  maxInput.maxLength = 30;
  maxInput.placeholder = "Max (kg, time)";
  maxInput.value = exercise.max || "";

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "primary-button";
  saveButton.textContent = "Save";

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "danger-button";
  deleteButton.textContent = "Delete";

  const save = () => {
    const nextName = nameInput.value.trim();
    const nextMax = maxInput.value.trim();

    if (!nextName) {
      nameInput.focus();
      return;
    }

    if (!nextMax) {
      maxInput.focus();
      return;
    }

    exercise.name = nextName;
    exercise.max = nextMax;
    saveState();
    render();
    syncWorkoutProgress(progressBar, completeMessage, workout);
  };

  nameInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    maxInput.focus();
  });

  maxInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    save();
  });

  saveButton.addEventListener("click", (event) => {
    event.stopPropagation();
    save();
  });

  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    showConfirmDialog({
      title: "Delete the exercise?",
      message: `This will remove "${exercise.name}".`,
      confirmLabel: "Yes",
      onConfirm: () => {
        workout.exercises = workout.exercises.filter((entry) => entry.id !== exercise.id);
        updateCompletionState(workout);
        saveState();
        render();
      },
    });
  });

  editor.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  editor.append(nameInput, maxInput, saveButton, deleteButton);
  item.appendChild(editor);
  nameInput.focus();
  nameInput.select();

  window.setTimeout(() => {
    document.addEventListener("click", handleOutsideExerciseEditor);
  }, 0);

  function handleOutsideExerciseEditor(event) {
    if (editor.contains(event.target)) {
      return;
    }

    document.removeEventListener("click", handleOutsideExerciseEditor);
    render();
    syncWorkoutProgress(progressBar, completeMessage, workout);
  }
}

function renderHomeExerciseEditor({ item, exercise }) {
  item.innerHTML = "";
  item.removeAttribute("role");
  item.removeAttribute("tabindex");

  const editor = document.createElement("div");
  editor.className = "card workout-form exercise-form inline-item-editor";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 80;
  nameInput.placeholder = "Exercise name";
  nameInput.value = exercise.name;

  const maxInput = document.createElement("input");
  maxInput.type = "text";
  maxInput.maxLength = 30;
  maxInput.placeholder = "Max (kg, time, reps)";
  maxInput.value = exercise.max || "";

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "primary-button";
  saveButton.textContent = "Save";

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "danger-button";
  deleteButton.textContent = "Delete";

  const save = () => {
    const nextName = nameInput.value.trim();
    const nextMax = maxInput.value.trim();

    if (!nextName) {
      nameInput.focus();
      return;
    }

    if (!nextMax) {
      maxInput.focus();
      return;
    }

    exercise.name = nextName;
    exercise.max = nextMax;
    saveState();
    render();
  };

  nameInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    maxInput.focus();
  });

  maxInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    save();
  });

  saveButton.addEventListener("click", (event) => {
    event.stopPropagation();
    save();
  });

  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    showConfirmDialog({
      title: "Delete the exercise?",
      message: `This will remove "${exercise.name}".`,
      confirmLabel: "Yes",
      onConfirm: () => {
        state.exercises = state.exercises.filter((entry) => entry.id !== exercise.id);
        state.selectedExerciseIds = state.selectedExerciseIds.filter((id) => id !== exercise.id);
        state.myWorkoutExerciseIds = state.myWorkoutExerciseIds.filter((id) => id !== exercise.id);
        state.selectedMyWorkoutExerciseIds = state.selectedMyWorkoutExerciseIds.filter((id) => id !== exercise.id);
        saveState();
        render();
      },
    });
  });

  editor.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  editor.append(nameInput, maxInput, saveButton, deleteButton);
  item.appendChild(editor);
  nameInput.focus();
  nameInput.select();

  window.setTimeout(() => {
    document.addEventListener("click", handleOutsideHomeExerciseEditor);
  }, 0);

  function handleOutsideHomeExerciseEditor(event) {
    if (editor.contains(event.target)) {
      return;
    }

    document.removeEventListener("click", handleOutsideHomeExerciseEditor);
    render();
  }
}

function renderWorkoutRowEditor({ item, workout }) {
  item.innerHTML = "";
  item.removeAttribute("role");
  item.removeAttribute("tabindex");

  const editor = document.createElement("div");
  editor.className = "card workout-form exercise-form inline-item-editor";

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.maxLength = 60;
  titleInput.placeholder = "Push day";
  titleInput.value = workout.title;

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "primary-button";
  saveButton.textContent = "Save";

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "danger-button";
  deleteButton.textContent = "Delete";

  const save = () => {
    const nextTitle = titleInput.value.trim();

    if (nextTitle.length < 3) {
      titleInput.focus();
      return;
    }

    workout.title = nextTitle;
    saveState();
    render();
  };

  titleInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    save();
  });

  saveButton.addEventListener("click", (event) => {
    event.stopPropagation();
    save();
  });

  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    showConfirmDialog({
      title: "Delete a workout?",
      message: `This will remove "${workout.title}".`,
      confirmLabel: "Yes",
      onConfirm: () => {
        state.workouts = state.workouts.filter((entry) => entry.id !== workout.id);

        if (state.lastCompletedWorkoutId === workout.id) {
          state.lastCompletedWorkoutId = null;
        }

        saveState();
        render();
      },
    });
  });

  editor.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  editor.append(titleInput, saveButton, deleteButton);
  item.appendChild(editor);
  titleInput.focus();
  titleInput.select();

  window.setTimeout(() => {
    document.addEventListener("click", handleOutsideWorkoutEditor);
  }, 0);

  function handleOutsideWorkoutEditor(event) {
    if (editor.contains(event.target)) {
      return;
    }

    document.removeEventListener("click", handleOutsideWorkoutEditor);
    render();
  }
}
function isWorkoutComplete(workout) {
  return workout.exercises.length > 0 && workout.exercises.every((exercise) => exercise.checked);
}

function getWorkoutProgress(workout) {
  if (workout.exercises.length === 0) {
    return 0;
  }

  const checkedCount = workout.exercises.filter((exercise) => exercise.checked).length;
  return (checkedCount / workout.exercises.length) * 100;
}

function updateCompletionState(workout) {
  if (isWorkoutComplete(workout)) {
    state.lastCompletedWorkoutId = workout.id;
    workout.lastCompletedAt = new Date().toISOString();
  }
}

function formatCompletionDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const completedDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const today = new Date();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffMs = todayDay.getTime() - completedDay.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays <= 0) {
    return "Today";
  }

  if (diffDays === 1) {
    return "Yesterday";
  }

  return `${diffDays} days ago`;
}

function resetAllWorkoutProgress() {
  state.workouts.forEach((workout) => {
    workout.exercises.forEach((exercise) => {
      exercise.checked = false;
    });
  });
}

function attachHoldGesture(handle, {
  dragElement,
  container,
  itemSelector,
  onHold,
  onReorder,
  dropTargets = [],
  onExternalDrop,
}) {
  let dragTimeoutId = null;
  let editTimeoutId = null;
  let suppressClick = false;
  let holdReady = false;
  let dragging = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let pointerOffsetY = 0;
  let pointerOffsetX = 0;
  let placeholder = null;
  let dragRect = null;
  let activeDropTarget = null;

  const clearTimers = () => {
    if (dragTimeoutId) {
      window.clearTimeout(dragTimeoutId);
      dragTimeoutId = null;
    }

    if (editTimeoutId) {
      window.clearTimeout(editTimeoutId);
      editTimeoutId = null;
    }
  };

  const cleanupPointerListeners = () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
  };

  const setActiveDropTarget = (nextDropTarget) => {
    if (activeDropTarget?.element === nextDropTarget?.element) {
      return;
    }

    if (activeDropTarget?.element) {
      activeDropTarget.element.classList.remove("nav-tab-drop-over");
    }

    activeDropTarget = nextDropTarget;

    if (activeDropTarget?.element) {
      activeDropTarget.element.classList.add("nav-tab-drop-over");
    }
  };

  const clearDropTargetState = () => {
    if (!activeDropTarget?.element) {
      activeDropTarget = null;
      return;
    }

    activeDropTarget.element.classList.remove("nav-tab-drop-over");
    activeDropTarget = null;
  };

  const getDropTargetAtPoint = (clientX, clientY) => {
    for (const target of dropTargets) {
      const rect = target.element.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return target;
      }
    }

    return null;
  };

  const resetVisualState = () => {
    dragElement.classList.remove("hold-ready");
    clearDropTargetState();

    if (!dragging) {
      return;
    }

    dragging = false;
    dragElement.classList.remove("dragging");
    dragElement.style.width = "";
    dragElement.style.left = "";
    dragElement.style.top = "";
    dragElement.style.position = "";
    dragElement.style.zIndex = "";
    dragElement.style.pointerEvents = "";
  };

  const startDrag = (event) => {
    dragging = true;
    suppressClick = true;
    dragRect = dragElement.getBoundingClientRect();
    pointerOffsetY = event.clientY - dragRect.top;
    pointerOffsetX = event.clientX - dragRect.left;

    placeholder = document.createElement("div");
    placeholder.className = "drag-placeholder";
    placeholder.style.height = `${dragRect.height}px`;

    container.insertBefore(placeholder, dragElement);

    dragElement.classList.add("dragging");
    dragElement.style.width = `${dragRect.width}px`;
    dragElement.style.left = `${dragRect.left}px`;
    dragElement.style.top = `${dragRect.top}px`;
    dragElement.style.position = "fixed";
    dragElement.style.zIndex = "50";
    dragElement.style.pointerEvents = "none";

    document.body.appendChild(dragElement);
    updateDragPosition(event);
  };

  const updateDragPosition = (event) => {
    if (!dragging) {
      return;
    }

    dragElement.style.left = `${event.clientX - pointerOffsetX}px`;
    dragElement.style.top = `${event.clientY - pointerOffsetY}px`;
    setActiveDropTarget(getDropTargetAtPoint(event.clientX, event.clientY));

    const siblings = [...container.querySelectorAll(itemSelector)].filter((item) => item !== dragElement);
    let inserted = false;

    for (const sibling of siblings) {
      const rect = sibling.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;

      if (event.clientY < midpoint) {
        container.insertBefore(placeholder, sibling);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      container.appendChild(placeholder);
    }
  };

  const finishDrag = (event) => {
    if (!dragging) {
      return;
    }

    const dropTarget = activeDropTarget ?? getDropTargetAtPoint(event.clientX, event.clientY);

    if (placeholder) {
      container.insertBefore(dragElement, placeholder);
      placeholder.remove();
      placeholder = null;
    }

    resetVisualState();

    if (dropTarget && typeof onExternalDrop === "function" && onExternalDrop(dropTarget.value)) {
      return;
    }

    const orderedIds = [...container.querySelectorAll(itemSelector)].map((item) => item.dataset.workoutId ?? item.dataset.exerciseId);
    onReorder(orderedIds);
  };

  const onPointerMove = (event) => {
    if (event.pointerId !== pointerId) {
      return;
    }

    const movedDistance = Math.hypot(event.clientX - startX, event.clientY - startY);

    if (!holdReady) {
      if (movedDistance > DRAG_START_DISTANCE_PX) {
        clearTimers();
        cleanupPointerListeners();
      }
      return;
    }

    if (!dragging && movedDistance > DRAG_START_DISTANCE_PX) {
      startDrag(event);
      return;
    }

    updateDragPosition(event);
  };

  const onPointerUp = (event) => {
    if (event.pointerId !== pointerId) {
      return;
    }

    clearTimers();
    cleanupPointerListeners();

    if (dragging) {
      finishDrag(event);
      dragElement.blur();
    } else if (holdReady) {
      suppressClick = true;
      onHold();
    }

    holdReady = false;
    pointerId = null;
    resetVisualState();
  };

  const onPointerCancel = (event) => {
    if (event.pointerId !== pointerId) {
      return;
    }

    clearTimers();
    cleanupPointerListeners();

    if (dragging && placeholder) {
      container.insertBefore(dragElement, placeholder);
      placeholder.remove();
      placeholder = null;
    }

    holdReady = false;
    pointerId = null;
    resetVisualState();
  };

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    holdReady = false;
    dragging = false;
    suppressClick = false;
    clearDropTargetState();

    dragTimeoutId = window.setTimeout(() => {
      holdReady = true;
      dragElement.classList.add("hold-ready");
    }, DRAG_HOLD_DURATION_MS);

    editTimeoutId = window.setTimeout(() => {
      if (dragging || pointerId !== event.pointerId) {
        return;
      }

      suppressClick = true;
      holdReady = false;
      pointerId = null;
      cleanupPointerListeners();
      resetVisualState();
      onHold();
    }, EDIT_HOLD_DURATION_MS);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  });

  handle.addEventListener(
    "click",
    (event) => {
      if (!suppressClick) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClick = false;
    },
    true
  );
}

function reorderCollectionByIds(collection, orderedIds) {
  const byId = new Map(collection.map((entry) => [entry.id, entry]));
  return orderedIds.map((id) => byId.get(id)).filter(Boolean);
}

function scrollIntoViewAfterKeyboard(element) {
  window.setTimeout(() => {
    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, 250);
}

function showConfirmDialog({ title, message, confirmLabel, cancelLabel = "Cancel", onConfirm }) {
  dialogRoot.innerHTML = "";

  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";

  const dialog = document.createElement("div");
  dialog.className = "dialog";

  const heading = document.createElement("h3");
  heading.textContent = title;

  const body = document.createElement("p");
  body.textContent = message;

  const actions = document.createElement("div");
  actions.className = "dialog-actions";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "ghost-button";
  cancelButton.textContent = cancelLabel;

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "primary-button";
  confirmButton.textContent = confirmLabel;

  cancelButton.addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      close();
    }
  });

  confirmButton.addEventListener("click", () => {
    onConfirm();
    close();
  });

  actions.append(cancelButton, confirmButton);
  dialog.append(heading, body, actions);
  backdrop.appendChild(dialog);
  dialogRoot.appendChild(backdrop);

  function close() {
    dialogRoot.innerHTML = "";
  }
}

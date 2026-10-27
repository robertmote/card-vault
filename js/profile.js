// The Profile tab: collector ID card fields and photo.
function renderProfile() {
  $('#pName').value = profile.name ?? ''; $('#pEmail').value = profile.email ?? '';
  $('#pPhoto').src = profile.photo || ''; $('#pPhoto').classList.toggle('hidden', !profile.photo);
  $('#pInitials').textContent = profile.photo ? '' : [...(profile.name || '?')][0].toUpperCase(); // [...s] keeps an emoji whole
  $('#pPhotoDel').classList.toggle('hidden', !profile.photo);
}

// Refresh fetches each distinct card once (copies in other conditions/binders share it), in batches where the API allows.

// --- Profile ---
$('#pName').onchange = e => { profile.name = e.target.value.trim(); save('profile'); renderProfile(); };
$('#pEmail').onchange = e => {
  if (!e.target.checkValidity()) return tell("That email address doesn't look right.");
  profile.email = e.target.value.trim(); save('profile');
};
// Photos are cropped square and shrunk to 256px so they fit easily in browser storage.
$('#pPhotoIn').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const img = await createImageBitmap(f), s = Math.min(img.width, img.height);
    const cv = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
    cv.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
    img.close(); // free the full-size decoded image right away
    profile.photo = cv.toDataURL('image/jpeg', 0.85); save('profile'); renderProfile();
  } catch { tell("Couldn't read that image. Try a JPG or PNG."); }
};
$('#pPhotoDel').onclick = () => { delete profile.photo; save('profile'); renderProfile(); };

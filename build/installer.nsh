; KaneApp s'appelait Kanevas : l'ancienne installation vit dans %LOCALAPPDATA%\Programs\Kanevas.
; La mise à jour installe désormais dans Programs\KaneApp. L'ancien désinstalleur (lancé par l'installateur sur
; l'ancien dossier, lu dans le registre) enlève Programs\Kanevas ; ce qui en resterait est supprimé après l'installation.

!macro customInit
  ${if} $INSTDIR == "$LOCALAPPDATA\Programs\Kanevas"
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\KaneApp"
  ${endif}
!macroend

!macro customInstall
  ${if} ${FileExists} "$LOCALAPPDATA\Programs\Kanevas\resources\app.asar"
  ${andIf} $INSTDIR != "$LOCALAPPDATA\Programs\Kanevas"
    RMDir /r "$LOCALAPPDATA\Programs\Kanevas"
  ${endif}
!macroend

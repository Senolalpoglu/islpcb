; Inno Setup script for ISL PCB.
; Build:  npm run installer      (packs the app, then runs ISCC on this file)
; Input:  ..\release\ISL_PCB     (produced by scripts\package.cjs)
; Output: output\ISL_PCB_Setup_<version>.exe

#define AppName "ISL PCB"
#define AppVersion "0.19.0"
#define AppPublisher "ISL"
#define AppExe "ISL PCB.exe"
#define AppExt ".islpcb"
#define AppProgId "ISLPCB.Circuit"

[Setup]
; Fixed GUID so upgrades replace the previous install. Never change it.
AppId={{8D5B7F3A-52C1-4E8B-9C1E-3F1A6B2D7E40}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=ISL_PCB_Setup_{#AppVersion}
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ChangesAssociations=yes
CloseApplications=yes

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
turkish.AssocCircuit=.islpcb devre dosyalarını {#AppName} ile ilişkilendir
english.AssocCircuit=Associate .islpcb circuit files with {#AppName}
turkish.FileTypeName=ISL PCB devre dosyası
english.FileTypeName=ISL PCB circuit file
turkish.LaunchApp=%1 uygulamasını başlat
english.LaunchApp=Launch %1

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "assoc"; Description: "{cm:AssocCircuit}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\release\ISL_PCB\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\icon.ico"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\icon.ico"; Tasks: desktopicon

[InstallDelete]
; The program used to be installed as "SNL PCB": remove the old program file and shortcuts when upgrading.
Type: files; Name: "{app}\SNL PCB.exe"
Type: files; Name: "{userprograms}\SNL PCB\SNL PCB.lnk"
Type: files; Name: "{autodesktop}\SNL PCB.lnk"

[Registry]
; Files saved under the old name keep opening in the program.
Root: HKA; Subkey: "Software\Classes\.snlpcb"; ValueType: string; ValueName: ""; ValueData: "{#AppProgId}"; Flags: uninsdeletevalue uninsdeletekeyifempty; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\{#AppExt}"; ValueType: string; ValueName: ""; ValueData: "{#AppProgId}"; Flags: uninsdeletevalue uninsdeletekeyifempty; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\{#AppProgId}"; ValueType: string; ValueName: ""; ValueData: "{cm:FileTypeName}"; Flags: uninsdeletekey; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\{#AppProgId}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\icon.ico"; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\{#AppProgId}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: assoc

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchApp,{#AppName}}"; Flags: nowait postinstall skipifsilent

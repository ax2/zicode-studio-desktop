#include <filesystem>
#include <optional>
#include <string>
#include <vector>
#include <windows.h>
#include <winrt/Microsoft.Windows.Widgets.Providers.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Foundation.h>

using namespace winrt;
using namespace Microsoft::Windows::Widgets::Providers;
using namespace Windows::Data::Json;

namespace
{
constexpr GUID provider_id{0x7f455b49, 0x267d, 0x445f, {0x82, 0xb4, 0x11, 0xb1, 0x44, 0x69, 0xcd, 0xa1}};
HANDLE idle_event{};
bool chinese()
{
    return PRIMARYLANGID(GetUserDefaultUILanguage()) == LANG_CHINESE;
}

std::optional<std::filesystem::path> installed_studio()
{
    constexpr auto key = L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ZiCode Studio Desktop";
    for (auto hive : {HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE})
    {
        for (auto view : {RRF_SUBKEY_WOW6464KEY, RRF_SUBKEY_WOW6432KEY})
        {
            wchar_t version[64]{};
            DWORD version_size = sizeof(version);
            if (RegGetValueW(hive, key, L"DisplayVersion", RRF_RT_REG_SZ | view, nullptr, version, &version_size) !=
                ERROR_SUCCESS)
                continue;
            unsigned major = 0, minor = 0, patch = 0;
            if (swscanf_s(version, L"%u.%u.%u", &major, &minor, &patch) != 3 ||
                (major == 0 && (minor < 6 || (minor == 6 && patch < 9))))
                continue;
            wchar_t dir[32768]{};
            DWORD size = sizeof(dir);
            if (RegGetValueW(hive, key, L"InstallLocation", RRF_RT_REG_SZ | view, nullptr, dir, &size) != ERROR_SUCCESS)
                continue;
            std::wstring path(dir);
            if (path.size() > 1 && path.front() == L'"' && path.back() == L'"')
                path = path.substr(1, path.size() - 2);
            auto exe = std::filesystem::path(path) / L"zicode-studio-desktop.exe";
            std::error_code error;
            if (exe.is_absolute() && std::filesystem::is_regular_file(exe, error))
                return exe;
        }
    }
    return std::nullopt;
}

void launch(std::filesystem::path const &exe, std::wstring const &action)
{
    auto command = L"\"" + exe.wstring() + L"\" --notes-widget " + action;
    STARTUPINFOW startup{sizeof(startup)};
    PROCESS_INFORMATION process{};
    check_bool(CreateProcessW(exe.c_str(), command.data(), nullptr, nullptr, FALSE, 0, nullptr,
                              exe.parent_path().c_str(), &startup, &process));
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
}

enum class Status { ready, studio_missing, launch_failed };

std::optional<Status> run_action(std::optional<std::filesystem::path> const &exe, std::wstring const &action)
{
    if (action != L"new" && action != L"recent" && action != L"pinned")
        return std::nullopt;
    if (!exe)
        return Status::studio_missing;
    try
    {
        launch(*exe, action);
        return Status::ready;
    }
    catch (hresult_error const &)
    {
        return Status::launch_failed;
    }
}

hstring card(Status state)
{
    bool zh = chinese();
    JsonObject result;
    result.SetNamedValue(L"type", JsonValue::CreateStringValue(L"AdaptiveCard"));
    result.SetNamedValue(L"version", JsonValue::CreateStringValue(L"1.5"));
    JsonArray actions;
    for (auto [verb, title] : std::initializer_list<std::pair<const wchar_t *, const wchar_t *>>{
             {L"new", zh ? L"新建笔记" : L"New note"},
             {L"recent", zh ? L"打开最近笔记" : L"Open recent note"},
             {L"pinned", zh ? L"打开置顶笔记" : L"Open pinned note"}})
    {
        JsonObject button;
        button.SetNamedValue(L"type", JsonValue::CreateStringValue(L"Action.Execute"));
        button.SetNamedValue(L"title", JsonValue::CreateStringValue(title));
        button.SetNamedValue(L"verb", JsonValue::CreateStringValue(verb));
        actions.Append(button);
    }
    JsonArray body;
    if (state != Status::ready)
    {
        JsonObject status;
        status.SetNamedValue(L"type", JsonValue::CreateStringValue(L"TextBlock"));
        status.SetNamedValue(L"wrap", JsonValue::CreateBooleanValue(true));
        const auto text = state == Status::studio_missing
                              ? (zh ? L"请先安装支持速记小组件的 Studio。"
                                    : L"Install a version of Studio that supports Quick Notes.")
                              : (zh ? L"无法打开 Studio，请重试。" : L"Could not open Studio. Try again.");
        status.SetNamedValue(L"text", JsonValue::CreateStringValue(text));
        body.Append(status);
    }
    for (auto const &action : actions)
    {
        JsonObject row;
        JsonArray one;
        one.Append(action);
        row.SetNamedValue(L"type", JsonValue::CreateStringValue(L"ActionSet"));
        row.SetNamedValue(L"actions", one);
        body.Append(row);
    }
    result.SetNamedValue(L"body", body);
    return result.Stringify();
}

void update(WidgetContext const &context, Status state)
{
    WidgetUpdateRequestOptions update(context.Id());
    update.Template(card(state));
    WidgetManager::GetDefault().UpdateWidget(update);
}

void refresh(WidgetContext const &context)
{
    update(context, installed_studio() ? Status::ready : Status::studio_missing);
}

struct Provider : implements<Provider, IWidgetProvider>
{
    Provider()
    {
        CoAddRefServerProcess();
    }
    ~Provider()
    {
        if (CoReleaseServerProcess() == 0)
            SetEvent(idle_event);
    }
    void CreateWidget(WidgetContext const &context)
    {
        refresh(context);
    }
    void DeleteWidget(hstring const &, hstring const &)
    {
    }
    void Activate(WidgetContext const &context)
    {
        refresh(context);
    }
    void Deactivate(hstring const &)
    {
    }
    void OnWidgetContextChanged(WidgetContextChangedArgs const &args)
    {
        refresh(args.WidgetContext());
    }
    void OnActionInvoked(WidgetActionInvokedArgs const &args)
    {
        const auto state = run_action(installed_studio(), std::wstring(args.Verb()));
        if (!state)
            return;
        try
        {
            update(args.WidgetContext(), *state);
        }
        catch (hresult_error const &)
        {
            // The widget may be removed after the action. Do not report a launch failure for an update failure.
        }
    }
};

struct Factory : implements<Factory, IClassFactory>
{
    HRESULT __stdcall CreateInstance(IUnknown *outer, REFIID iid, void **result) noexcept override
    {
        if (!result)
            return E_POINTER;
        *result = nullptr;
        if (outer)
            return CLASS_E_NOAGGREGATION;
        try
        {
            return make<Provider>().as(iid, result);
        }
        catch (...)
        {
            return to_hresult();
        }
    }
    HRESULT __stdcall LockServer(BOOL lock) noexcept override
    {
        if (lock)
            CoAddRefServerProcess();
        else if (CoReleaseServerProcess() == 0)
            SetEvent(idle_event);
        return S_OK;
    }
};
} // namespace

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR command, int)
{
    if (std::wstring(command) != L"-ActivateNotesWidget")
        return 0;
    try
    {
        init_apartment(apartment_type::multi_threaded);
        handle idle(CreateEventW(nullptr, TRUE, FALSE, nullptr));
        idle_event = idle.get();
        if (!idle_event)
            return 1;
        auto factory = make<Factory>();
        DWORD cookie{};
        check_hresult(
            CoRegisterClassObject(provider_id, factory.get(), CLSCTX_LOCAL_SERVER, REGCLS_MULTIPLEUSE, &cookie));
        WaitForSingleObject(idle_event, INFINITE);
        CoRevokeClassObject(cookie);
        return 0;
    }
    catch (...)
    {
        return 1;
    }
}

#ifdef STUDIO_TEST_NOTES_WIDGET
// The test creates the real COM provider. Its action probe launches only this
// test binary, with the same arguments and CreateProcessW path as the provider.
int wmain(int argc, wchar_t **argv)
{
    constexpr auto event_var = L"STUDIO_WIDGET_TEST_EVENT";
    if (argc != 1)
    {
        wchar_t event_name[128]{};
        const auto length = GetEnvironmentVariableW(event_var, event_name, static_cast<DWORD>(std::size(event_name)));
        if (argc != 3 || std::wstring_view(argv[1]) != L"--notes-widget" ||
            length == 0 || length >= std::size(event_name) ||
            !std::wstring_view(event_name).ends_with(std::wstring(L"-") + argv[2]))
            return 7;
        handle signal(OpenEventW(EVENT_MODIFY_STATE, FALSE, event_name));
        return signal && SetEvent(signal.get()) ? 0 : 8;
    }
    init_apartment(apartment_type::multi_threaded);
    handle idle(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    idle_event = idle.get();
    auto factory = make<Factory>();
    winrt::com_ptr<::IUnknown> provider;
    check_hresult(factory->CreateInstance(nullptr, guid_of<IWidgetProvider>(), provider.put_void()));
    const std::vector<hstring> verbs{L"new", L"recent", L"pinned"};
    auto body = JsonObject::Parse(card(Status::ready)).GetNamedArray(L"body");
    if (body.Size() != verbs.size())
        return 1;
    for (uint32_t i = 0; i < body.Size(); ++i)
    {
        auto action = body.GetObjectAt(i).GetNamedArray(L"actions").GetObjectAt(0);
        if (action.GetNamedString(L"verb") != verbs[i] || action.GetNamedString(L"type") != L"Action.Execute")
            return 2;
    }
    auto missing = JsonObject::Parse(card(Status::studio_missing)).GetNamedArray(L"body");
    auto failed = JsonObject::Parse(card(Status::launch_failed)).GetNamedArray(L"body");
    if (missing.Size() != 4 || failed.Size() != 4 ||
        missing.GetObjectAt(0).GetNamedString(L"text") == failed.GetObjectAt(0).GetNamedString(L"text"))
        return 3;

    std::wstring module(32768, L'\0');
    auto length = GetModuleFileNameW(nullptr, module.data(), static_cast<DWORD>(module.size()));
    if (length == 0 || length >= module.size())
        return 4;
    module.resize(length);
    const std::filesystem::path exe = module;
    if (run_action(std::nullopt, L"new") != Status::studio_missing ||
        run_action(exe / L"missing.exe", L"new") != Status::launch_failed || run_action(exe, L"unknown"))
        return 5;
    for (auto const &verb : verbs)
    {
        const std::wstring action(verb);
        const auto event_name = L"Local\\ZiCodeQuickNotesTest-" + std::to_wstring(GetCurrentProcessId()) + L"-" + action;
        handle signal(CreateEventW(nullptr, TRUE, FALSE, event_name.c_str()));
        if (!signal || !SetEnvironmentVariableW(event_var, event_name.c_str()) ||
            run_action(exe, action) != Status::ready || WaitForSingleObject(signal.get(), 5000) != WAIT_OBJECT_0)
            return 6;
    }
    SetEnvironmentVariableW(event_var, nullptr);
    return 0;
}
#endif